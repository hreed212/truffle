import { logger } from "@truffle/db/logger";
const debug = logger("db:loaders:schema:artifactsLoader");

import { TruffleDB } from "@truffle/db/db";
import { IdObject, toIdObject } from "@truffle/db/meta";
import * as fse from "fs-extra";
import path from "path";
import Config from "@truffle/config";
import TruffleResolver from "@truffle/resolver";
import type { Resolver } from "@truffle/resolver";
import { Environment } from "@truffle/environment";
import { ContractObject, NetworkObject } from "@truffle/contract-schema/spec";
import Web3 from "web3";

import { Project, LiveProject } from "@truffle/db/loaders/project";
import { GetCompilation } from "@truffle/db/loaders/resources/compilations";
import { FindContracts } from "@truffle/db/loaders/resources/contracts";
import { AddContractInstances } from "@truffle/db/loaders/resources/contractInstances";
import { AddNetworks } from "@truffle/db/loaders/resources/networks";
import {
  WorkflowCompileResult,
  CompiledContract
} from "@truffle/compile-common/src/types";
import WorkflowCompile from "@truffle/workflow-compile";

type LoaderNetworkObject = {
  network: Pick<DataModel.Network, "id" | "networkId">;
  loaderContractObject: LoaderContractObject;
};

type LoadableNetwork = {
  name: string;
  networkId: string;
  networkObject: NetworkObject;
}

type LoaderContractObject = {
  contract: DataModel.Contract;
  artifact: ContractObject;
}

export class ArtifactsLoader {
  private db: TruffleDB;
  private compilationConfig: Partial<Config>;
  private resolver: Resolver;

  constructor(db: TruffleDB, config?: Partial<Config>) {
    this.db = db;
    this.compilationConfig = config;
    // @ts-ignore
    this.resolver = new TruffleResolver(config);
  }

  async load(): Promise<void> {
    debug("Compiling...");
    const result: WorkflowCompileResult = await WorkflowCompile.compile(
      this.compilationConfig
    );
    debug("Compiled.");

    debug("Initializing project...");
    const project = await Project.initialize({
      project: {
        directory: this.compilationConfig.working_directory
      },
      db: this.db
    });
    debug("Initialized project.");

    debug("Loading compilations...");
    const { contracts } = await project.loadCompilations({ result });
    debug("Loaded compilations.");

    debug("Assigning contract names...");
    await project.loadNames({ assignments: { contracts } });
    debug("Assigned contract names.");

    const loaderContractObjects = await this.pairContractsWithArtifacts(
      contracts
    );

    const config = Config.detect({
      working_directory: this.compilationConfig["contracts_directory"]
    });

    debug("Loading networks...");
    const loaderNetworkObjects = [];
    for (const name of Object.keys(config.networks)) {
      try {
        debug("Connecting to network name: %s", name);
        const { web3, networkId } = await this.connectNetwork(config, name);
        debug("Connected to network name: %s, networkId: %s", name, networkId);

        const liveProject = await project.connect({
          provider: web3.currentProvider
        });

        loaderNetworkObjects.push(...await this.loadNetworksForContracts(
          liveProject,
          { name, networkId },
          loaderContractObjects
        ));
      } catch (error) {
        debug("error %o", error);
        continue;
      }
    }
    debug("Loaded networks.");

    // assign names for networks we just added
    const networks = [
      ...new Set(loaderNetworkObjects.map(({ network: { id } }) => id))
    ].map(id => ({ id }));

    debug("Assigning network names...");
    await project.loadNames({ assignments: { networks } });
    debug("Assigned network names.");

    await project.loadContractInstances({
      contractInstances: loaderNetworkObjects.map(({
        network,
        loaderContractObject: {
          contract,
          artifact
        }
      }) => ({
        artifact,
        contract: toIdObject(contract),
        network: toIdObject(network) as IdObject<DataModel.Network>
      }))
    });
    // debug("Loading contractInstances...");
    // await this.loadContractInstances(loaderNetworkObjects);
    // debug("Loaded contractInstances.");
  }

  async pairContractsWithArtifacts(
    contractIdObjects: IdObject<DataModel.Contract>[]
  ): Promise<LoaderContractObject[]> {
    // get full representation
    debug("Retrieving contracts, ids: %o...", contractIdObjects.map(({ id }) => id));
    const {
      data: {
        contracts
      }
    } = await this.db.query(FindContracts, {
      ids: contractIdObjects.map(({ id }) => id)
    });
    debug("Retrieved contracts, ids: %o.", contractIdObjects.map(({ id }) => id));

    // and resolve artifact
    return contracts
      .map((contract: DataModel.Contract) => {
        const { name } = contract;

        debug("Requiring artifact for %s...", name);
        // @ts-ignore
        const artifact = this.resolver.require(name);
        debug("Required artifact for %s.", name);

        return { contract, artifact };
      });
  }

  async loadNetworksForContracts(
    project: LiveProject,
    network: Pick<DataModel.NetworkInput, "name" | "networkId">,
    loaderContractObjects: LoaderContractObject[]
  ): Promise<LoaderNetworkObject[]> {
    const { name, networkId } = network;

    const loaderNetworkObjects = [];

    for (const { contract, artifact } of loaderContractObjects) {
      if (!artifact.networks[networkId]) {
        continue;
      }

      debug("Identifying historic network for contract name: %s...", contract.name);

      const { transactionHash } = artifact.networks[networkId];

      debug(
        "Loading network name: %s for transactionHash: %s...",
        name,
        transactionHash
      );
      const { network } = await project.loadNetworkForTransaction({
        transactionHash,
        network: {
          name,
          networkId
        }
      });
      debug(
        "Loading network name: %s for transactionHash: %s...",
        name,
        transactionHash
      );

      loaderNetworkObjects.push({
        network: {
          id: network.id,
          networkId
        },
        loaderContractObject: { contract, artifact }
      });
    }

    return loaderNetworkObjects;
  }

  async connectNetwork(
    config: Config,
    name: string
  ): Promise<{
    web3: Web3
    networkId: DataModel.NetworkInput["networkId"]
  }> {
    config.network = name;
    await Environment.detect(config);

    const web3: Web3 = new Web3(config.provider);

    const networkId = await web3.eth.net.getId();

    return { web3, networkId };
  }

  getNetworkLinks(bytecode: DataModel.Bytecode, links?: NetworkObject["links"]) {
    if (!links) {
      return [];
    }

    return Object.entries(links).map(link => {
      let linkReferenceIndexByName = bytecode.linkReferences.findIndex(
        ({ name }) => name === link[0]
      );

      let linkValue = {
        value: link[1],
        linkReference: {
          bytecode: { id: bytecode.id },
          index: linkReferenceIndexByName
        }
      };

      return linkValue;
    });
  }

  async loadContractInstances(
    loaderNetworkObjects: LoaderNetworkObject[]
  ) {
    const contractInstances = loaderNetworkObjects.map(loaderNetworkObject => {
      const {
        network,
        loaderContractObject: {
          contract,
          artifact
        }
      } = loaderNetworkObject;

      const {
        address,
        transactionHash,
        links
      } = artifact.networks[network.networkId];

      let createBytecodeLinkValues = this.getNetworkLinks(
        contract.createBytecode,
        links
      );
      let callBytecodeLinkValues = this.getNetworkLinks(
        contract.callBytecode,
        links
      );

      let instance = {
        address,
        contract: toIdObject(contract),
        network: toIdObject(network),
        creation: {
          transactionHash,
          constructor: {
            createBytecode: {
              bytecode: toIdObject(contract.createBytecode),
              linkValues: createBytecodeLinkValues
            }
          }
        },
        callBytecode: {
          bytecode: toIdObject(contract.callBytecode),
          linkValues: callBytecodeLinkValues
        }
      };
      return instance;
    });

    await this.db.query(AddContractInstances, {
      contractInstances
    });
  }
}
