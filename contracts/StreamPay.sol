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

contract StreamPay is Ownable {
    using SafeERC20 for IERC20;

    struct Stream {
        address payer;
        address merchant;
        uint256 amountPerSecond;   // in token smallest units (e.g. cents)
        uint256 startTime;
        uint256 lastClaimed;
        uint256 totalPaid;
        bool active;
    }

    IERC20 public immutable paymentToken;

    mapping(uint256 => Stream) public streams;
    mapping(address => uint256[]) public payerStreams;
    mapping(address => uint256[]) public merchantStreams;
    uint256 public streamCount;

    event StreamCreated(uint256 indexed streamId, address payer, address merchant, uint256 amountPerSecond);
    event PaymentClaimed(uint256 indexed streamId, address merchant, uint256 amount);
    event StreamCancelled(uint256 indexed streamId);

    constructor(address _paymentToken) Ownable(msg.sender) {
        paymentToken = IERC20(_paymentToken);
    }

    // Create a stream: payer approves tokens first, then calls createStream
    function createStream(address _merchant, uint256 _amountPerSecond) external returns (uint256) {
        require(_merchant != address(0), "merchant zero");
        require(_amountPerSecond > 0, "rate zero");

        uint256 streamId = streamCount++;
        streams[streamId] = Stream({
            payer: msg.sender,
            merchant: _merchant,
            amountPerSecond: _amountPerSecond,
            startTime: block.timestamp,
            lastClaimed: block.timestamp,
            totalPaid: 0,
            active: true
        });

        payerStreams[msg.sender].push(streamId);
        merchantStreams[_merchant].push(streamId);

        emit StreamCreated(streamId, msg.sender, _merchant, _amountPerSecond);
        return streamId;
    }

    // Merchant claims accrued payments
    function claim(uint256 _streamId) external returns (uint256) {
        Stream storage s = streams[_streamId];
        require(s.active, "stream inactive");
        require(s.merchant == msg.sender, "not merchant");

        uint256 elapsed = block.timestamp - s.lastClaimed;
        uint256 owed = elapsed * s.amountPerSecond;
        require(owed > 0, "nothing owed");

        s.totalPaid += owed;
        s.lastClaimed = block.timestamp;

        paymentToken.safeTransferFrom(s.payer, msg.sender, owed);

        emit PaymentClaimed(_streamId, msg.sender, owed);
        return owed;
    }

    // Payer cancels stream; remaining balance stays with merchant
    function cancel(uint256 _streamId) external {
        Stream storage s = streams[_streamId];
        require(s.active, "stream inactive");
        require(s.payer == msg.sender, "not payer");

        s.active = false;
        emit StreamCancelled(_streamId);
    }

    // Read: accrued but unclaimed amount for a merchant
    function accrued(uint256 _streamId) external view returns (uint256) {
        Stream memory s = streams[_streamId];
        if (!s.active) return 0;
        uint256 elapsed = block.timestamp - s.lastClaimed;
        return elapsed * s.amountPerSecond;
    }

    // Read: all streams for an address
    function getPayerStreams(address _payer) external view returns (uint256[] memory) {
        return payerStreams[_payer];
    }

    function getMerchantStreams(address _merchant) external view returns (uint256[] memory) {
        return merchantStreams[_merchant];
    }
}
