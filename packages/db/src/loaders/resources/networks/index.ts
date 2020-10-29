import { logger } from "@truffle/db/logger";
const debug = logger("db:loaders:resources:networks");

import { GetNetwork } from "./get.graphql";
import { AddNetworks } from "./add.graphql";
export { AddNetworks };

import { IdObject } from "@truffle/db/meta";
import { Load } from "@truffle/db/loaders/types";

type TransactionHash = any;
type NetworkId = any;

export function* generateNetworkGet(
  { id }: IdObject<DataModel.Network>
): Load<DataModel.Network | undefined, { graphql: "network" }> {
  debug("Generating network get...");

  const response = yield {
    type: "graphql",
    request: GetNetwork,
    variables: {
      id
    }
  }

  const network = response.data.network;

  debug("Generated network get.");
  return network;
}

export interface GenerateTransactionNetworkLoadOptions {
  transactionHash: TransactionHash;
  network: Pick<DataModel.NetworkInput, "name" | "networkId">;
}

export function* generateTranasctionNetworkLoad({
  transactionHash,
  network: {
    name,
    networkId
  }
}: GenerateTransactionNetworkLoadOptions): Load<DataModel.Network> {
  debug("Generating transaction network load...");
  const historicBlock = yield* generateHistoricBlockFetch(transactionHash);

  const result = yield* generateNetworkLoad({
    name,
    networkId,
    historicBlock
  });

  debug("Generated transaction network load.");
  return result;
}

function* generateHistoricBlockFetch(
  transactionHash: TransactionHash
): Load<DataModel.Block, { web3: "eth_getTransactionByHash" }> {
  debug("Generating historic block fetch...");
  const response = yield {
    type: "web3",
    method: "eth_getTransactionByHash",
    params: [transactionHash]
  };

  const {
    result: {
      blockNumber,
      blockHash: hash
    }
  } = response;

  const height = parseInt(blockNumber);

  const historicBlock = { height, hash };

  debug("Generated historic block fetch.");
  return historicBlock;
}

function* generateNetworkLoad(
  input: DataModel.NetworkInput
): Load<DataModel.Network, { graphql: "networksAdd" }> {
  debug("Generating network load...");
  const response = yield {
    type: "graphql",
    request: AddNetworks,
    variables: {
      networks: [input]
    }
  }

  const network = response.data.networksAdd.networks[0];

  debug("Generated network load.");
  return network;
}

