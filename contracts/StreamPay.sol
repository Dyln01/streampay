// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * StreamPay — Per-second subscription payments in native MON on Monad.
 *
 * Model: the payer escrows MON up front when creating a stream. The contract
 * holds the escrow, the merchant claims whatever has vested so far at any
 * time, and the payer can cancel at any time to settle both sides (earned MON
 * goes to the merchant, everything unearned is refunded to the payer).
 *
 * Native MON cannot be pulled with an ERC-20 allowance, so escrow is the only
 * correct design for a currency-denominated stream. It also makes cancel(),
 * refunds and owner sweeps arithmetically exact, because every payout comes
 * from a balance the contract actually holds.
 *
 * Built for Monad Metropolis 2026 — Track 2: Consumer Products & Payments.
 */

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract StreamPay is Ownable, Pausable, ReentrancyGuard {
    /// Bump this on every redeploy so a deployment is self-identifying.
    string public constant VERSION = "2.0.0-native-mon";

    struct Stream {
        address payer;
        address merchant;
        uint256 amountPerSecond; // wei of MON vested per second
        uint256 deposit;         // MON escrowed for this stream
        uint256 withdrawn;       // MON already paid out to the merchant
        uint256 startTime;
        uint256 duration;        // 0 = runs until the deposit runs out
        bool active;
        bool cancelled;          // true once the payer has settled this stream
    }

    mapping(uint256 => Stream) public streams;
    mapping(address => uint256[]) public payerStreams;
    mapping(address => uint256[]) public merchantStreams;

    uint256 public streamCount;
    /// Invariant: address(this).balance >= totalEscrowed, always.
    uint256 public totalEscrowed;

    uint256 public constant MAX_DURATION = 365 days;

    event StreamCreated(
        uint256 indexed streamId,
        address indexed payer,
        address indexed merchant,
        uint256 amountPerSecond,
        uint256 duration,
        uint256 deposit
    );
    event StreamFunded(uint256 indexed streamId, uint256 amount, uint256 newDeposit);
    event StreamExtended(uint256 indexed streamId, uint256 newDuration, uint256 addedDeposit);
    event StreamTransferred(uint256 indexed streamId, address indexed from, address indexed to);
    event PaymentClaimed(uint256 indexed streamId, address indexed merchant, uint256 amount);
    event StreamCancelled(uint256 indexed streamId, address indexed payer, uint256 refund, uint256 paidToMerchant);
    event StreamEnded(uint256 indexed streamId, address indexed merchant, uint256 totalPaid);

    constructor() Ownable(msg.sender) {}

    /* ------------------------------------------------------------------ */
    /*                          vesting math                              */
    /* ------------------------------------------------------------------ */

    /// MON vested to the merchant since startTime, capped by duration and deposit.
    /// Idempotent: re-evaluating it after a stream ends yields the same value,
    /// so cancel() can settle an ended stream safely.
    function _vested(Stream memory s, uint256 ts) internal pure returns (uint256) {
        if (ts <= s.startTime) return 0;
        uint256 vested = (ts - s.startTime) * s.amountPerSecond;
        uint256 cap = s.duration > 0 ? s.duration * s.amountPerSecond : s.deposit;
        if (vested > cap) vested = cap;
        if (vested > s.deposit) vested = s.deposit;
        return vested;
    }

    /// True once the schedule is over (duration elapsed) or the deposit is spent.
    function _hasEnded(Stream memory s, uint256 ts) internal pure returns (bool) {
        if (s.duration > 0 && ts >= s.startTime + s.duration) return true;
        return _vested(s, ts) >= s.deposit;
    }

    function _pay(address _to, uint256 _amount) internal {
        (bool ok, ) = payable(_to).call{value: _amount}("");
        require(ok, "MON transfer failed");
    }

    /* ------------------------------------------------------------------ */
    /*                          payer actions                             */
    /* ------------------------------------------------------------------ */

    /**
     * Open a stream and escrow the MON that funds it.
     * duration > 0: msg.value must cover duration * rate (over-funding is fine,
     *               the excess comes back on cancel).
     * duration == 0: msg.value is the whole budget; the stream runs until it is spent.
     */
    function createStream(
        address _merchant,
        uint256 _amountPerSecond,
        uint256 _duration
    ) external payable whenNotPaused nonReentrant returns (uint256) {
        require(_merchant != address(0), "merchant zero");
        require(_amountPerSecond > 0, "rate zero");
        require(_duration <= MAX_DURATION, "duration too long");
        require(msg.value > 0, "no escrow");

        if (_duration > 0) {
            require(msg.value >= _amountPerSecond * _duration, "escrow below rate*duration");
        }

        uint256 streamId = streamCount++;
        streams[streamId] = Stream({
            payer: msg.sender,
            merchant: _merchant,
            amountPerSecond: _amountPerSecond,
            deposit: msg.value,
            withdrawn: 0,
            startTime: block.timestamp,
            duration: _duration,
            active: true,
            cancelled: false
        });

        payerStreams[msg.sender].push(streamId);
        merchantStreams[_merchant].push(streamId);
        totalEscrowed += msg.value;

        emit StreamCreated(streamId, msg.sender, _merchant, _amountPerSecond, _duration, msg.value);
        return streamId;
    }

    /// Top up the escrow of one of your own active streams.
    function fundStream(uint256 _streamId) external payable whenNotPaused nonReentrant {
        Stream storage s = streams[_streamId];
        require(s.active, "stream inactive");
        require(s.payer == msg.sender, "not payer");
        require(msg.value > 0, "no funds");

        s.deposit += msg.value;
        totalEscrowed += msg.value;

        emit StreamFunded(_streamId, msg.value, s.deposit);
    }

    /// Lengthen a fixed-term stream, escrowing the MON the extra time will consume.
    function extendStream(
        uint256 _streamId,
        uint256 _additionalDuration
    ) external payable whenNotPaused nonReentrant {
        Stream storage s = streams[_streamId];
        require(s.active, "stream inactive");
        require(s.payer == msg.sender, "not payer");
        require(_additionalDuration > 0, "zero extension");
        require(s.duration > 0, "unlimited stream - use fundStream");
        require(s.duration + _additionalDuration <= MAX_DURATION, "exceeds max");
        require(msg.value >= _additionalDuration * s.amountPerSecond, "escrow too small");

        s.duration += _additionalDuration;
        s.deposit += msg.value;
        totalEscrowed += msg.value;

        emit StreamExtended(_streamId, s.duration, msg.value);
    }

    /**
     * Settle a stream and walk away. Pays the merchant everything already
     * vested and refunds the payer everything that has not.
     *
     * Deliberately NOT whenNotPaused: pausing may stop new subscriptions, but
     * it must never be able to trap a payer's escrow or a merchant's earnings.
     */
    function cancel(uint256 _streamId) external nonReentrant {
        Stream storage s = streams[_streamId];
        require(s.payer == msg.sender, "not payer");
        // One-shot: without a settled flag, a second cancel() would pay out the
        // same escrow twice and drain the escrow backing other streams.
        require(!s.cancelled, "already cancelled");

        uint256 vested = _vested(s, block.timestamp);
        uint256 owed = vested > s.withdrawn ? vested - s.withdrawn : 0;
        uint256 refund = s.deposit > vested ? s.deposit - vested : 0;

        s.withdrawn = vested;
        s.active = false;
        s.cancelled = true;
        totalEscrowed -= owed + refund;

        if (owed > 0) _pay(s.merchant, owed);
        if (refund > 0) _pay(s.payer, refund);

        emit StreamCancelled(_streamId, s.payer, refund, owed);
    }

    /// Hand a subscription over to another payer.
    function transferStream(uint256 _streamId, address _newPayer) external whenNotPaused {
        Stream storage s = streams[_streamId];
        require(s.active, "stream inactive");
        require(s.payer == msg.sender, "not payer");
        require(_newPayer != address(0), "zero address");
        require(_newPayer != s.payer, "same payer");

        uint256[] storage old = payerStreams[s.payer];
        for (uint256 i = 0; i < old.length; i++) {
            if (old[i] == _streamId) {
                old[i] = old[old.length - 1];
                old.pop();
                break;
            }
        }

        address from = s.payer;
        s.payer = _newPayer;
        payerStreams[_newPayer].push(_streamId);

        emit StreamTransferred(_streamId, from, _newPayer);
    }

    /* ------------------------------------------------------------------ */
    /*                        merchant actions                            */
    /* ------------------------------------------------------------------ */

    /**
     * Claim everything that has vested so far.
     * Deliberately NOT whenNotPaused — a merchant's earnings must always be
     * withdrawable, including while the owner has new subscriptions paused.
     */
    function claim(uint256 _streamId) external nonReentrant returns (uint256) {
        Stream storage s = streams[_streamId];
        require(s.merchant == msg.sender, "not merchant");
        require(s.active, "stream inactive");

        uint256 ts = block.timestamp;
        uint256 vested = _vested(s, ts);
        uint256 claimable = vested > s.withdrawn ? vested - s.withdrawn : 0;
        require(claimable > 0, "nothing owed");

        s.withdrawn = vested;
        totalEscrowed -= claimable;

        bool ended = _hasEnded(s, ts);
        if (ended) s.active = false;

        _pay(msg.sender, claimable);
        emit PaymentClaimed(_streamId, msg.sender, claimable);
        if (ended) emit StreamEnded(_streamId, msg.sender, vested);

        return claimable;
    }

    /* ------------------------------------------------------------------ */
    /*                              views                                 */
    /* ------------------------------------------------------------------ */

    /// Currently claimable by the merchant (0 once a stream is settled).
    function accrued(uint256 _streamId) public view returns (uint256) {
        Stream memory s = streams[_streamId];
        if (!s.active) return 0;
        uint256 vested = _vested(s, block.timestamp);
        return vested > s.withdrawn ? vested - s.withdrawn : 0;
    }

    /// Total vested to the merchant so far, settled or not.
    function vestedAmount(uint256 _streamId) external view returns (uint256) {
        return _vested(streams[_streamId], block.timestamp);
    }

    /// What the payer would get back by cancelling right now.
    function calculateRefund(uint256 _streamId) external view returns (uint256) {
        Stream memory s = streams[_streamId];
        if (s.cancelled) return 0; // already settled: nothing left to refund
        uint256 vested = _vested(s, block.timestamp);
        return s.deposit > vested ? s.deposit - vested : 0;
    }

    /// True when the schedule has finished but the stream is not settled yet.
    function isEnded(uint256 _streamId) external view returns (bool) {
        Stream memory s = streams[_streamId];
        return s.active && _hasEnded(s, block.timestamp);
    }

    function getStreamStatus(uint256 _streamId) external view returns (string memory) {
        Stream memory s = streams[_streamId];
        if (s.cancelled) return "cancelled";
        if (!s.active) return "settled";
        return _hasEnded(s, block.timestamp) ? "ended" : "active";
    }

    function getPayerStreams(address _payer) external view returns (uint256[] memory) {
        return payerStreams[_payer];
    }

    function getMerchantStreams(address _merchant) external view returns (uint256[] memory) {
        return merchantStreams[_merchant];
    }

    /* ------------------------------------------------------------------ */
    /*                          owner controls                            */
    /* ------------------------------------------------------------------ */

    /// Stops new subscriptions. Never blocks claiming or cancelling.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// Recover only what is NOT owed to a payer or merchant.
    function sweepExcess() external onlyOwner nonReentrant {
        uint256 bal = address(this).balance;
        uint256 excess = bal > totalEscrowed ? bal - totalEscrowed : 0;
        require(excess > 0, "no excess");
        _pay(msg.sender, excess);
    }
}
