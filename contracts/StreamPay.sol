// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * StreamPay — Per-second subscription payments on Monad
 * Merchant creates a stream; payer approves ERC-20; payments accrue per-second
 * and are claimed by the merchant. Built for Monad Metropolis Hackathon
 * Track 2: Consumer Products & Payments + Agora Cross-Border bounty.
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract StreamPay is Ownable, Pausable {
    using SafeERC20 for IERC20;

    struct Stream {
        address payer;
        address merchant;
        uint256 amountPerSecond;
        uint256 startTime;
        uint256 lastClaimed;
        uint256 totalPaid;
        uint256 duration;    // 0 = unlimited, otherwise seconds
        bool active;
    }

    IERC20 public immutable paymentToken;

    mapping(uint256 => Stream) public streams;
    mapping(address => uint256[]) public payerStreams;
    mapping(address => uint256[]) public merchantStreams;
    uint256 public streamCount;

    // Max duration: 365 days
    uint256 public constant MAX_DURATION = 365 days;

    event StreamCreated(uint256 indexed streamId, address payer, address merchant, uint256 amountPerSecond, uint256 duration);
    event PaymentClaimed(uint256 indexed streamId, address merchant, uint256 amount);
    event StreamCancelled(uint256 indexed streamId, uint256 refundToPayer);
    event StreamExpired(uint256 indexed streamId, address merchant, uint256 remaining);

    constructor(address _paymentToken) Ownable(msg.sender) {
        paymentToken = IERC20(_paymentToken);
    }

    function _checkActive(uint256 _streamId) internal {
        Stream storage s = streams[_streamId];
        if (!s.active) return;
        if (s.duration > 0 && block.timestamp >= s.startTime + s.duration) {
            s.active = false;
            uint256 remaining = s.totalPaid;
            emit StreamExpired(_streamId, s.merchant, remaining);
        }
    }

    function createStream(
        address _merchant,
        uint256 _amountPerSecond,
        uint256 _duration
    ) external whenNotPaused returns (uint256) {
        require(_merchant != address(0), "merchant zero");
        require(_amountPerSecond > 0, "rate zero");
        require(_duration <= MAX_DURATION, "duration too long");

        uint256 streamId = streamCount++;
        streams[streamId] = Stream({
            payer: msg.sender,
            merchant: _merchant,
            amountPerSecond: _amountPerSecond,
            startTime: block.timestamp,
            lastClaimed: block.timestamp,
            totalPaid: 0,
            duration: _duration,
            active: true
        });

        payerStreams[msg.sender].push(streamId);
        merchantStreams[_merchant].push(streamId);

        emit StreamCreated(streamId, msg.sender, _merchant, _amountPerSecond, _duration);
        return streamId;
    }

    // Merchant claims accrued payments
    function claim(uint256 _streamId) external whenNotPaused returns (uint256) {
        Stream storage s = streams[_streamId];
        require(s.merchant == msg.sender, "not merchant");

        uint256 elapsed = block.timestamp - s.lastClaimed;
        uint256 owed = elapsed * s.amountPerSecond;

        // Allow claim if stream is active, expired, or was cancelled with remaining funds
        bool expired = s.duration > 0 && block.timestamp >= s.startTime + s.duration;
        bool hasFunds = s.totalPaid > 0;
        require(s.active || expired || hasFunds, "stream inactive");
        require(owed > 0, "nothing owed");

        s.totalPaid += owed;
        s.lastClaimed = block.timestamp;

        if (expired) {
            s.active = false;
            emit StreamExpired(_streamId, s.merchant, s.totalPaid);
        }

        paymentToken.safeTransferFrom(s.payer, msg.sender, owed);

        emit PaymentClaimed(_streamId, msg.sender, owed);
        return owed;
    }

    function cancel(uint256 _streamId) external whenNotPaused {
        Stream storage s = streams[_streamId];
        require(s.active, "stream inactive");
        require(s.payer == msg.sender, "not payer");

        s.active = false;
        uint256 owed = (block.timestamp - s.lastClaimed) * s.amountPerSecond;
        uint256 refund = s.totalPaid + owed;

        emit StreamCancelled(_streamId, refund);
    }

    // Read: accrued but unclaimed amount for a merchant
    function accrued(uint256 _streamId) external view returns (uint256) {
        Stream memory s = streams[_streamId];
        if (!s.active) return 0;
        if (s.duration > 0 && block.timestamp >= s.startTime + s.duration) return 0;
        uint256 elapsed = block.timestamp - s.lastClaimed;
        return elapsed * s.amountPerSecond;
    }

    function getPayerStreams(address _payer) external view returns (uint256[] memory) {
        return payerStreams[_payer];
    }

    function getMerchantStreams(address _merchant) external view returns (uint256[] memory) {
        return merchantStreams[_merchant];
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // Payer can extend an active stream's duration
    function extendStream(uint256 _streamId, uint256 _additionalDuration) external whenNotPaused {
        Stream storage s = streams[_streamId];
        require(s.active, "stream inactive");
        require(s.payer == msg.sender, "not payer");
        require(_additionalDuration > 0, "zero extension");
        require(s.duration + _additionalDuration <= MAX_DURATION, "exceeds max");
        s.duration += _additionalDuration;
    }

    // Payer can transfer stream ownership to another payer
    function transferStream(uint256 _streamId, address _newPayer) external whenNotPaused {
        Stream storage s = streams[_streamId];
        require(s.active, "stream inactive");
        require(s.payer == msg.sender, "not payer");
        require(_newPayer != address(0), "zero address");
        require(_newPayer != s.payer, "same payer");

        // Remove from old payer
        uint256[] storage oldStreams = payerStreams[s.payer];
        for (uint256 i = 0; i < oldStreams.length; i++) {
            if (oldStreams[i] == _streamId) {
                oldStreams[i] = oldStreams[oldStreams.length - 1];
                payerStreams[s.payer].pop();
                break;
            }
        }

        s.payer = _newPayer;
        payerStreams[_newPayer].push(_streamId);
    }

    // Payer can reclaim remaining paid funds if merchant never claims
    function emergencyWithdraw(uint256 _streamId) external whenNotPaused {
        Stream storage s = streams[_streamId];
        require(s.active, "stream inactive");
        require(s.payer == msg.sender, "not payer");
        uint256 elapsed = block.timestamp - s.startTime;
        uint256 totalAccrued = elapsed * s.amountPerSecond;
        uint256 remaining = s.totalPaid >= totalAccrued ? s.totalPaid - totalAccrued : 0;
        require(remaining > 0, "nothing to withdraw");
        s.totalPaid = 0;
        paymentToken.safeTransfer(msg.sender, remaining);
    }

    // Grace period: merchant can claim after stream expires (7 days)
    function claimAfterExpiry(uint256 _streamId) external whenNotPaused returns (uint256) {
        Stream storage s = streams[_streamId];
        require(!s.active, "stream still active");
        require(s.merchant == msg.sender, "not merchant");
        require(block.timestamp <= s.startTime + s.duration + 7 days, "grace period expired");
        uint256 owed = s.totalPaid;
        require(owed > 0, "nothing owed");
        s.totalPaid = 0;
        paymentToken.safeTransferFrom(s.payer, msg.sender, owed);
        emit PaymentClaimed(_streamId, msg.sender, owed);
        return owed;
    }

    // Per-stream pause (owner only)
    function pauseStream(uint256 _streamId) external onlyOwner whenNotPaused {
        streams[_streamId].active = false;
    }

    function unpauseStream(uint256 _streamId) external onlyOwner whenNotPaused {
        streams[_streamId].active = true;
    }

    // View: calculate what payer would get back if they cancel now
    function calculateRefund(uint256 _streamId) external view returns (uint256) {
        Stream storage s = streams[_streamId];
        require(s.active, "stream inactive");
        uint256 owed = (block.timestamp - s.lastClaimed) * s.amountPerSecond;
        return s.totalPaid + owed;
    }

    // View: human-readable stream status
    function getStreamStatus(uint256 _streamId) external view returns (string memory) {
        Stream storage s = streams[_streamId];
        if (!s.active) return "inactive";
        if (s.duration > 0 && block.timestamp >= s.startTime + s.duration) return "expired";
        return "active";
    }

    // Owner can recover stuck tokens
    function sweepTokens(address _token, uint256 _amount) external onlyOwner {
        IERC20(_token).safeTransfer(msg.sender, _amount);
    }
}
