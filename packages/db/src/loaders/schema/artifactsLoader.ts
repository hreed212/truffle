import { logger } from "@truffle/db/logger";
const debug = logger("db:loaders:schema:artifactsLoader");

import { TruffleDB } from "@truffle/db/db";
import { toIdObject } from "@truffle/db/meta";
import * as fse from "fs-extra";
import path from "path";
import Config from "@truffle/config";
import TruffleResolver from "@truffle/resolver";
import type { Resolver } from "@truffle/resolver";
import { Environment } from "@truffle/environment";
import { ContractObject, NetworkObject } from "@truffle/contract-schema/spec";
import Web3 from "web3";

import { Project } from "@truffle/db/loaders";
import { GetCompilation } from "@truffle/db/loaders/resources/compilations";
import { AddContractInstances } from "@truffle/db/loaders/resources/contractInstances";
import { AddNetworks } from "@truffle/db/loaders/resources/networks";
import {
  WorkflowCompileResult,
  CompiledContract
} from "@truffle/compile-common/src/types";
import WorkflowCompile from "@truffle/workflow-compile";

type LoaderNetworkObject = {
  network: DataModel.Network;
  loaderContractObject: LoaderContractObject;
};

type LoaderContractObject = {
  contract: DataModel.Contract;
  compiledContract: CompiledContract;
  artifact: ContractObject;
}

export class ArtifactsLoader {
  private db: TruffleDB;
  private config: Partial<Config>;
  private resolver: Resolver;

  constructor(db: TruffleDB, config?: Partial<Config>) {
    this.db = db;
    this.config = config;
    // @ts-ignore
    this.resolver = new TruffleResolver(config);
  }

  async load(): Promise<void> {
    const result: WorkflowCompileResult = await WorkflowCompile.compile(
      this.config
    );

    const project = await Project.initialize({
      project: {
        directory: this.config.working_directory
      },
      db: this.db
    });

    // third parameter in loadCompilation is for whether or not we need
    // to update nameRecords (i.e. is this happening in test)
    const { compilations, contracts } = await project.loadCompilations({
      result
    });

    await project.loadNames({ assignments: { contracts } });

    //map contracts and contract instances to compiler
    await Promise.all(
      compilations.map(async ({ id }, index) => {
        const {
          data: {
            compilation
          }
        } = await this.db.query(GetCompilation, { id });

        const loaderContractObjects = result.compilations[index].contracts
          .map((compiledContract: CompiledContract) => {
            const { contractName } = compiledContract;

            const contract: DataModel.Contract = compilation.contracts.find(
              ({ name }) => name === contractName
            );

            // @ts-ignore
            const artifact = this.resolver.require(contractName);

            return { contract, compiledContract, artifact };
          });

        const loaderNetworkObjects = await this.loadNetworks(
          loaderContractObjects,
          this.config["contracts_directory"]
        );

        // assign names for networks we just added
        const networks = [
          ...new Set(loaderNetworkObjects.map(({ network: { id } }) => id))
        ].map(id => ({ id }));

        await project.loadNames({ assignments: { networks } });

        if (loaderNetworkObjects.length) {
          await this.loadContractInstances(loaderNetworkObjects);
        }
      })
    );
  }

  async loadNetworks(
    loaderContractObjects: LoaderContractObject[],
    workingDirectory: string
  ): Promise<LoaderNetworkObject[]> {
    const networksByContract = await Promise.all(loaderContractObjects.map(
      loaderContractObject =>
        this.loadNetworksForContract(loaderContractObject, workingDirectory)
    ));
    return networksByContract.flat();
  }

  async loadNetworksForContract(
    loaderContractObject: LoaderContractObject,
    workingDirectory: string,
  ): Promise<LoaderNetworkObject[]> {
    const { artifact, contract } = loaderContractObject;
    const artifactsNetworks = artifact.networks;

    // short circuit
    if (Object.keys(artifactsNetworks).length === 0) {
      return [];
    }

    const config = Config.detect({ working_directory: workingDirectory });

    const configNetworks = [];
    for (const networkName of Object.keys(config.networks)) {
      const network = await this.loadNetworkForContractNetwork(
        config,
        networkName,
        artifactsNetworks
      );

      if (network) {
        configNetworks.push({
          network,
          loaderContractObject
        });
      }
    }

    return configNetworks;
  }

  async loadNetworkForContractNetwork(
    config: Config,
    networkName: string,
    artifactNetworks: {
      [networkId: string]: NetworkObject;
    }
  ): Promise<DataModel.Network | undefined> {
    config.network = networkName;
    await Environment.detect(config);
    let networkId;
    let web3;
    try {
      web3 = new Web3(config.provider);
      networkId = await web3.eth.net.getId();
    } catch (err) {
      return;
    }

    const artifactNetwork: NetworkObject = artifactNetworks[networkId];
    if (!artifactNetwork) {
      return;
    }

    const {
      transactionHash,
      address,
      links
    } = artifactNetwork;

    const transaction = await web3.eth.getTransaction(transactionHash);

    const historicBlock = {
      height: transaction.blockNumber,
      hash: transaction.blockHash
    };

    const networksAdd = await this.db.query(AddNetworks, {
      networks: [
        {
          name: networkName,
          networkId: networkId,
          historicBlock: historicBlock
        }
      ]
    });

    return networksAdd.data.networksAdd.networks[0];
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
