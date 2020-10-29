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
  contract: IdObject<DataModel.Contract>;
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

    const contractArtifacts = await this.pairContractsWithArtifacts(
      contracts
    );

    const config = Config.detect({
      working_directory: this.compilationConfig["contracts_directory"]
    });

    debug("Loading networks...");
    const networks = [];
    for (const name of Object.keys(config.networks)) {
      try {
        debug("Connecting to network name: %s", name);
        const { web3 } = await this.connectNetwork(config, name);

        const liveProject = await project.connect({
          provider: web3.currentProvider
        });

        const result = await liveProject.loadMigration({
          network: { name },
          contractArtifacts
        });

        networks.push(result.network);
      } catch (error) {
        debug("error %o", error);
        continue;
      }
    }
    debug("Loaded networks.");

    debug("Assigning network names...");
    await project.loadNames({ assignments: { networks } });
    debug("Assigned network names.");
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

        return {
          contract: toIdObject(contract),
          artifact
        };
      });
  }

  async connectNetwork(
    config: Config,
    name: string
  ): Promise<{
    web3: Web3
  }> {
    config.network = name;
    await Environment.detect(config);

    const web3: Web3 = new Web3(config.provider);

    return { web3 };
  }
}
