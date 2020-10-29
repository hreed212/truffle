import { logger } from "@truffle/db/logger";
const debug = logger("db:loaders:commands:migrate");

import gql from "graphql-tag";
import { ContractObject } from "@truffle/contract-schema/spec";
import { toIdObject, IdObject } from "@truffle/db/meta";
import { Load } from "@truffle/db/loaders/types";

import { generateContractGet } from "@truffle/db/loaders/resources/contracts";
import { generateNetworkGet } from "@truffle/db/loaders/resources/networks";
import {
  generateContractInstancesLoad
} from "@truffle/db/loaders/resources/contractInstances";

export interface GenerateMigrateLoadOptions {
  contractInstances: {
    artifact: ContractObject;
    contract: IdObject<DataModel.Contract>;
    network: IdObject<DataModel.Network>;
  }[]
}

export function* generateMigrateLoad(
  options: GenerateMigrateLoadOptions
): Load<{ contractInstances: DataModel.ContractInstance[] }> {
  const loadableContractInstances = [];
  for (const contractInstance of options.contractInstances) {
    const { contract, network, artifact } = contractInstance;

    const {
      createBytecode,
      callBytecode
    } = yield* generateContractGet(contract);

    const {
      networkId
    } = yield* generateNetworkGet(network);

    debug("networkId %o", networkId);
    const networkObject = artifact.networks[networkId];
    debug("networkObject %o", networkObject);
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

  debug("loadableContractInstances: %o", loadableContractInstances);
  const contractInstances = yield* generateContractInstancesLoad(
    loadableContractInstances
  );

  return { contractInstances };
}
