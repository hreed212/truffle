import { logger } from "@truffle/db/logger";
const debug = logger("db:loaders:commands:migrate");

import gql from "graphql-tag";
import { ContractObject } from "@truffle/contract-schema/spec";
import { toIdObject, IdObject } from "@truffle/db/meta";
import { Load } from "@truffle/db/loaders/types";

import { generateContractGet } from "@truffle/db/loaders/resources/contracts";
import {
  generateTranasctionNetworkLoad,
  generateNetworkIdFetch,
  generateNetworkGet
} from "@truffle/db/loaders/resources/networks";
import {
  LoadableContractInstance,
  generateContractInstancesLoad
} from "@truffle/db/loaders/resources/contractInstances";

export interface GenerateMigrateLoadOptions {
  network: Pick<DataModel.Network, "name">;
  contractArtifacts: {
    contract: IdObject<DataModel.Contract>;
    artifact: ContractObject;
  }[]
}

export function* generateMigrateLoad(
  options: GenerateMigrateLoadOptions
): Load<{
  network: IdObject<DataModel.Network>,
  contractInstances: IdObject<DataModel.ContractInstance>[]
}> {
  const networkId = yield* generateNetworkIdFetch();

  let latestNetwork: DataModel.Network | undefined;
  const contractNetworks: ContractNetwork[] = [];
  for (const { contract, artifact } of options.contractArtifacts) {
    if (!artifact.networks[networkId]) {
      // skip over artifacts that don't contain this network
      continue;
    }

    const { transactionHash } = artifact.networks[networkId];

    const network = yield* generateTranasctionNetworkLoad({
      transactionHash,
      network: {
        name: options.network.name,
        networkId
      }
    });

    if (
      latestNetwork &&
      latestNetwork.historicBlock.height < network.historicBlock.height
    ) {
      latestNetwork = network;
    }

    contractNetworks.push({
      network: toIdObject(network),
      contractArtifact: {
        contract,
        artifact
      }
    })
  }

  const loadableContractInstances = yield* processContractNetworks(
    contractNetworks
  );

  const contractInstances = yield* generateContractInstancesLoad(
    loadableContractInstances
  );

  return {
    network: toIdObject(latestNetwork),
    contractInstances: contractInstances.map(toIdObject)
  };
}

interface ContractNetwork {
  network: IdObject<DataModel.Network>;
  contractArtifact: {
    contract: IdObject<DataModel.Contract>;
    artifact: ContractObject;
  }
}

function* processContractNetworks(
  contractNetworks: ContractNetwork[]
): Load<LoadableContractInstance[]> {
  const loadableContractInstances = [];
  for (const {
    network,
    contractArtifact: {
      contract,
      artifact
    }
  } of contractNetworks) {
    const {
      createBytecode,
      callBytecode
    } = yield* generateContractGet(contract);

    const {
      networkId
    } = yield* generateNetworkGet(network);

    const networkObject = artifact.networks[networkId];
    if (!networkObject) {
      continue;
    }

    loadableContractInstances.push({
      contract,
      network,
      networkObject,
      bytecodes: {
        call: {
          bytecode: toIdObject(callBytecode),
          linkReferences: callBytecode.linkReferences
        },
        create: {
          bytecode: toIdObject(createBytecode),
          linkReferences: createBytecode.linkReferences
        }
      }
    });
  }

  return loadableContractInstances;
}
