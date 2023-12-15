import dotenv from "dotenv";
import { getAccountNonce } from "permissionless";
import { UserOperation, bundlerActions } from "permissionless";
import { pimlicoBundlerActions } from "permissionless/actions/pimlico";
import { Hash, createClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { goerli } from "viem/chains";
import {
  SAFE_ADDRESSES_MAP,
  encodeCallData,
  getAccountAddress,
  getAccountInitCode,
} from "../utils/safe";
import { submitUserOperation, signUserOperation } from "../utils/userOps";
import { setTimeout } from "timers/promises";
import {
  generateTransferCallData,
  getERC20Decimals,
  getERC20Balance,
  mintERC20Token,
} from "../utils/erc20";
import { generateMintingCallData } from "../utils/erc721";

dotenv.config();
const paymaster = "pimlico";

const privateKey = process.env.PRIVATE_KEY;

const entryPointAddress = process.env
  .PIMLICO_ENTRYPOINT_ADDRESS as `0x${string}`;
const multiSendAddress = process.env.PIMLICO_MULTISEND_ADDRESS as `0x${string}`;

const saltNonce = BigInt(process.env.PIMLICO_NONCE as string);

const chain = process.env.PIMLICO_CHAIN;
const chainID = Number(process.env.PIMLICO_CHAIN_ID);

const safeVersion = process.env.SAFE_VERSION as string;

const rpcURL = process.env.PIMLICO_RPC_URL;
const apiKey = process.env.PIMLICO_API_KEY;

const erc20PaymasterAddress = process.env
  .PIMLICO_ERC20_PAYMASTER_ADDRESS as `0x${string}`;
const usdcTokenAddress = process.env
  .PIMLICO_USDC_TOKEN_ADDRESS as `0x${string}`;
const erc20TokenAddress = process.env
  .PIMLICO_ERC20_TOKEN_CONTRACT as `0x${string}`;
const erc721TokenAddress = process.env
  .PIMLICO_ERC721_TOKEN_CONTRACT as `0x${string}`;

const argv = process.argv.slice(2);
if (argv.length != 1) {
  throw new Error("TX Type Argument not passed."); // account || erc20 || erc721
}

const txType: string = argv[0];
if (txType != "account" && txType != "erc20" && txType != "erc721") {
  throw new Error("TX Type Argument Invalid");
}

const safeAddresses = (
  SAFE_ADDRESSES_MAP as Record<string, Record<string, any>>
)[safeVersion];
let chainAddresses;
if (safeAddresses) {
  chainAddresses = safeAddresses[chainID];
}

if (apiKey === undefined) {
  throw new Error(
    "Please replace the `apiKey` env variable with your Pimlico API key",
  );
}

if (!privateKey) {
  throw new Error(
    "Please populate .env file with demo Private Key. Recommended to not use your personal private key.",
  );
}

const signer = privateKeyToAccount(privateKey as Hash);
console.log("Signer Extracted from Private Key.");

let bundlerClient;
let publicClient;
if (chain == "goerli") {
  bundlerClient = createClient({
    transport: http(`https://api.pimlico.io/v1/${chain}/rpc?apikey=${apiKey}`),
    chain: goerli,
  })
    .extend(bundlerActions)
    .extend(pimlicoBundlerActions);

  publicClient = createPublicClient({
    transport: http(rpcURL),
    chain: goerli,
  });
} else {
  throw new Error(
    "Current code only support limited networks. Please make required changes if you want to use custom network.",
  );
}

const initCode = await getAccountInitCode({
  owner: signer.address,
  addModuleLibAddress: chainAddresses.ADD_MODULES_LIB_ADDRESS,
  safe4337ModuleAddress: chainAddresses.SAFE_4337_MODULE_ADDRESS,
  safeProxyFactoryAddress: chainAddresses.SAFE_PROXY_FACTORY_ADDRESS,
  safeSingletonAddress: chainAddresses.SAFE_SINGLETON_ADDRESS,
  saltNonce: saltNonce,
  multiSendAddress: multiSendAddress,
  erc20TokenAddress: usdcTokenAddress,
  paymasterAddress: erc20PaymasterAddress,
});
console.log("\nInit Code Created.");

const senderAddress = await getAccountAddress({
  client: publicClient,
  owner: signer.address,
  addModuleLibAddress: chainAddresses.ADD_MODULES_LIB_ADDRESS,
  safe4337ModuleAddress: chainAddresses.SAFE_4337_MODULE_ADDRESS,
  safeProxyFactoryAddress: chainAddresses.SAFE_PROXY_FACTORY_ADDRESS,
  safeSingletonAddress: chainAddresses.SAFE_SINGLETON_ADDRESS,
  saltNonce: saltNonce,
  multiSendAddress: multiSendAddress,
  erc20TokenAddress: usdcTokenAddress,
  paymasterAddress: erc20PaymasterAddress,
});
console.log("\nCounterfactual Sender Address Created:", senderAddress);
console.log(
  "Address Link: https://" + chain + ".etherscan.io/address/" + senderAddress,
);

const contractCode = await publicClient.getBytecode({ address: senderAddress });

if (contractCode) {
  console.log("\nThe Safe is already deployed.");
  if (txType == "account") {
    console.log("");
    process.exit(0);
  }
} else {
  console.log(
    "\nDeploying a new Safe and executing calldata passed with it (if any).\n",
  );
}

const newNonce = await getAccountNonce(publicClient, {
  entryPoint: entryPointAddress,
  sender: senderAddress,
});
console.log("\nNonce for the sender received from EntryPoint.");

// Fetch USDC balance of sender
const usdcDecimals = await getERC20Decimals(usdcTokenAddress, publicClient);
const usdcAmount = BigInt(10 ** usdcDecimals);
let senderUSDCBalance = await getERC20Balance(
  usdcTokenAddress,
  publicClient,
  senderAddress,
);
console.log(
  "\nSafe Wallet USDC Balance:",
  Number(senderUSDCBalance / usdcAmount),
);

if (senderUSDCBalance < BigInt(1) * usdcAmount) {
  console.log(
    "\nPlease deposit atleast 2 USDC Token for paying the Paymaster.",
  );
  while (senderUSDCBalance < BigInt(1) * usdcAmount) {
    await setTimeout(30000);
    senderUSDCBalance = await getERC20Balance(
      usdcTokenAddress,
      publicClient,
      senderAddress,
    );
  }
  console.log(
    "\nUpdated Safe Wallet USDC Balance:",
    Number(senderUSDCBalance / usdcAmount),
  );
}

let txCallData!: `0x${string}`;

if (txType == "account") {
  txCallData = encodeCallData({
    to: senderAddress,
    data: "0x",
    value: 0n,
  });
} else if (txType == "erc20") {
  // Token Configurations
  const erc20Decimals = await getERC20Decimals(erc20TokenAddress, publicClient);
  const erc20Amount = BigInt(10 ** erc20Decimals);
  let senderERC20Balance = await getERC20Balance(
    erc20TokenAddress,
    publicClient,
    senderAddress,
  );
  console.log(
    "\nSafe Wallet ERC20 Balance:",
    Number(senderERC20Balance / erc20Amount),
  );

  // Trying to mint tokens (Make sure ERC20 Token Contract is mintable by anyone).
  if (senderERC20Balance < erc20Amount) {
    console.log("\nMinting ERC20 Tokens to Safe Wallet.");
    await mintERC20Token(
      erc20TokenAddress,
      publicClient,
      signer,
      senderAddress,
      erc20Amount,
      chain,
      paymaster,
    );

    while (senderERC20Balance < erc20Amount) {
      await setTimeout(15000);
      senderERC20Balance = await getERC20Balance(
        erc20TokenAddress,
        publicClient,
        senderAddress,
      );
    }
    console.log(
      "\nUpdated Safe Wallet ERC20 Balance:",
      Number(senderERC20Balance / erc20Amount),
    );
  }
  txCallData = encodeCallData({
    to: erc20TokenAddress,
    data: generateTransferCallData(signer.address, erc20Amount), // transfer() function call with corresponding data.
    value: 0n,
  });
} else if (txType == "erc721") {
  txCallData = encodeCallData({
    to: erc721TokenAddress,
    data: generateMintingCallData(signer.address), // safeMint() function call with corresponding data.
    value: 0n,
  });
}

const gasPriceResult = await bundlerClient.getUserOperationGasPrice();

const sponsoredUserOperation: UserOperation = {
  sender: senderAddress,
  nonce: newNonce,
  initCode: contractCode ? "0x" : initCode,
  callData: txCallData,
  callGasLimit: 100_000n, // Gas Values Hardcoded for now at a high value
  verificationGasLimit: 500_000n,
  preVerificationGas: 50_000n,
  maxFeePerGas: gasPriceResult.fast.maxFeePerGas,
  maxPriorityFeePerGas: gasPriceResult.fast.maxPriorityFeePerGas,
  paymasterAndData: erc20PaymasterAddress,
  signature: "0x",
};

sponsoredUserOperation.signature = await signUserOperation(
  sponsoredUserOperation,
  signer,
  chainID,
  entryPointAddress,
  chainAddresses.SAFE_4337_MODULE_ADDRESS,
);

await submitUserOperation(
  sponsoredUserOperation,
  bundlerClient,
  entryPointAddress,
  chain,
);
