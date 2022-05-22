import { Contract } from "ethers";
import { prepareMetaTx } from "../MetaTxService";
import _ from "lodash";
import axios from "axios";

interface VRFNodeOpts {
  url: string;
}

export class VRFEthersContractWrapperBuilder<T extends Contract> {
  constructor(private readonly baseContract: T) {}

  usingVRFNode(opts: VRFNodeOpts): T {
    const contract = this.baseContract;
    const contractPrototype = Object.getPrototypeOf(contract);
    const wrappedContract = Object.assign(
      Object.create(contractPrototype),
      contract);

    const functionNames: string[] = Object.keys(contract.functions);
    functionNames.forEach(functionName => {
      if (functionName.indexOf("(") !== -1) {
        const isCall = contract.interface.getFunction(functionName).constant;

        if (!isCall && !["executeMetaTransaction", "provideRandomnessAndExecuteMetaTransaction"].includes(functionName)) {
          const pureFunctionNameWithoutParentheses = functionName.split("(")[0];
          (wrappedContract[pureFunctionNameWithoutParentheses] as any) = async function (...args: any[]) {

            // const tx = await contract.populateTransaction[functionName](...args);
            const abi = contract.interface;
            // const functionAbi = _.pick(abi.functions[functionName + "()"], ["inputs", "name", "outputs", "stateMutability", "type"]); // Quick hack here

            // TODO: improve getting pure abi
            const functionAbi = getAbiForFunction(abi, functionName);
            
            // inputs: [
            //   {
            //     internalType: "address",
            //     name: "operator",
            //     type: "address",
            //   },
            //   {
            //     internalType: "bool",
            //     name: "approved",
            //     type: "bool",
            //   },
            // ],
            // name: "setApprovalForAll",
            // outputs: [],
            // stateMutability: "nonpayable",
            // type: "function",

            // console.log({functionAbi, fabi: abi.functions, functionName});

            const metaTxDetails = await prepareMetaTx(contract.signer, contract, functionAbi, args);
            const address = await contract.signer.getAddress();
            console.log({metaTxDetails, address});

            // console.log("Function ABI:", functionAbi);

            // Execute meta transaction
            
            // return await contract.executeMetaTransaction(
            //   address,
            //   metaTxDetails.functionSignature,
            //   metaTxDetails.r,
            //   metaTxDetails.s,
            //   metaTxDetails.v
            // );

            const { proofHex, hashHex } = await requestRandomnessForMetaTx(metaTxDetails);

            // TODO: switch to this way
            return await contract.provideRandomnessAndExecuteMetaTransaction(
              hashHex,
              address,
              metaTxDetails.functionSignature,
              metaTxDetails.r,
              metaTxDetails.s,
              metaTxDetails.v
            );

            // const sentTx = await contract.signer.sendTransaction(tx);
  
            // // Tweak the tx.wait so the receipt has extra properties
            // addContractWait(contract, sentTx);
  
            // return sentTx;
          }; 
        }
      }
    });

    return wrappedContract;
  }
}

async function requestRandomnessForMetaTx(metaTxDetails: any) {
  const vrfNodeUrl = "https://redstone-vrf-oracle-node-1.redstone.finance/vrf-requests";
  const dataHex = metaTxDetails.functionSignature; // TODO: add all contract details merged
  const response = await axios.post(vrfNodeUrl, {
    message_hex: dataHex.replace("0x", ""),
  });
  console.log("Received response from RedStone VRF node:", response.data);

  const proofHex = response.data.pi_hex;
  const hashHex = response.data.hash_hex;

  return { proofHex, hashHex };
}

function getAbiForFunction(contractAbi: any, functionName: string) {
  const functionAbi = _.pick(contractAbi.functions[functionName], ["inputs", "name", "outputs", "stateMutability", "type"]); // Quick hack here
  functionAbi.inputs = functionAbi.inputs.map((input: any) => {
    const newInput = _.pick(input, "internalType", "name", "type");
    if (!newInput.internalType) {
      newInput.internalType = newInput.type;
    }
    return newInput;
  });
  return functionAbi;
}
