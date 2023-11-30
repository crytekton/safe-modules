using ISafe2 as safeContract;

methods {
    function SUPPORTED_ENTRYPOINT() external returns(address) envfree;
    // function _._msgSender() internal => ERC2771MessageSender() expect address;
    function _.checkSignatures(bytes32, bytes, bytes) external => DISPATCHER(true);

    //ISafe harnessed functions
    function safeContract.getSignatureTimestamps(bytes signature) external returns (uint96) envfree;
    function safeContract.getValidAfterTimestamp(bytes sigs) external returns (uint48) envfree;
    function safeContract.getValidUntilTimestamp(bytes sigs) external returns (uint48) envfree;

    function safeContract.getSignatures(bytes signature) external returns (bytes) envfree;
    function safeContract.getSignatureTimestampsFromValidationData(uint256 validationData) external returns (uint96) envfree;

    // Optional
    function validateUserOp(Safe4337Module.UserOperation,bytes32,uint256) external returns(uint256);
    function executeUserOp(address, uint256, bytes, uint8) external;
    function executeUserOpWithErrorString(address, uint256, bytes, uint8) external;
    function Safe4337Module.getOperationHash(
        address safe,
        bytes callData,
        uint256 nonce,
        uint256 preVerificationGas,
        uint256 verificationGasLimit,
        uint256 callGasLimit,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas,
        uint48 validAfter,
        uint48 validUntil
    ) external returns(bytes32) envfree => CONSTANT;
}

rule validationDataLastBitCorrespondsCheckSignatures(address sender,
        Safe4337Module.UserOperation userOp,
        bytes32 dummyData,
        uint256 missingAccountFunds) {
    env e;
    uint48 validAfter;
    uint48 validUntil;
    require validAfter == safeContract.getValidAfterTimestamp(userOp.signature);
    require validUntil == safeContract.getValidUntilTimestamp(userOp.signature);

    bytes signatures = safeContract.getSignatures(userOp.signature);
    bytes32 transactionHash = getOperationHash(userOp.sender,
            userOp.callData,
            userOp.nonce,
            userOp.preVerificationGas,
            userOp.verificationGasLimit,
            userOp.callGasLimit,
            userOp.maxFeePerGas,
            userOp.maxPriorityFeePerGas,
            validAfter,
            validUntil);

    bytes checkSignaturesBytes;
    safeContract.checkSignatures@withrevert(e, transactionHash, checkSignaturesBytes, signatures);
    bool checkSignaturesReverted = lastReverted;

    uint256 validationData = validateUserOp(e, userOp, dummyData, missingAccountFunds);
    assert checkSignaturesReverted => (validationData & 1) == 1, "validation data incorrect";
}
