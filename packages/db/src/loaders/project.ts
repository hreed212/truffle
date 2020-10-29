import { logger } from "@truffle/db/logger";
const debug = logger("db:loaders:project");

import {DocumentNode} from "graphql";
import type Web3 from "web3";
import {WorkflowCompileResult} from "@truffle/compile-common";
import {ContractObject} from "@truffle/contract-schema/spec";

import {toIdObject, IdObject} from "@truffle/db/meta";

import {
  generateCompileLoad,
  generateInitializeLoad,
  generateNamesLoad,
  generateMigrateLoad
} from "./commands";

import {
  GenerateTransactionNetworkLoadOptions,
  generateTranasctionNetworkLoad
} from "./resources/networks";

import {LoaderRunner, forDb} from "./run";

interface ITruffleDB {
  query: (query: DocumentNode | string, variables: any) => Promise<any>;
}

export interface InitializeOptions {
  project: DataModel.ProjectInput;
  db: ITruffleDB;
}

export class Project {
  protected run: LoaderRunner;
  private forProvider: (provider: Web3["currentProvider"]) => { run: LoaderRunner };
  private project: IdObject<DataModel.Project>;

  static async initialize(options: InitializeOptions): Promise<Project> {
    const {db, project: input} = options;

    const { run, forProvider } = forDb(db);

    const project = await run(generateInitializeLoad, input);

    return new Project({run, forProvider, project});
  }

  async connect(options: {
    provider: Web3["currentProvider"]
  }): Promise<LiveProject> {
    const { run } = this.forProvider(options.provider);

    return new LiveProject({
      run,
      project: this.project
    });
  }

  async loadCompilations(options: {
    result: WorkflowCompileResult;
  }): Promise<{
    compilations: IdObject<DataModel.Compilation>[];
    contracts: IdObject<DataModel.Contract>[];
  }> {
    const {result} = options;

    const {compilations, contracts} = await this.run(
      generateCompileLoad,
      result
    );

    return {
      compilations: compilations.map(toIdObject),
      contracts: contracts.map(toIdObject)
    };
  }

  async loadNames(options: {
    assignments: Partial<{
      [collectionName: string]: IdObject[];
    }>;
  }): Promise<{
    nameRecords: IdObject<DataModel.NameRecord>[];
  }> {
    const nameRecords = await this.run(
      generateNamesLoad,
      this.project,
      options.assignments
    );
    return {
      nameRecords: nameRecords.map(toIdObject)
    };
  }

  async loadContractInstances(options: {
    contractInstances: {
      artifact: ContractObject;
      contract: IdObject<DataModel.Contract>;
      network: IdObject<DataModel.Network>;
    }[]
  }): Promise<{
    contractInstances: IdObject<DataModel.ContractInstance>[]
  }> {
    debug("contractInstances %o", options.contractInstances);
    const { contractInstances } = await this.run(generateMigrateLoad, options);

    return {
      contractInstances: contractInstances.map(toIdObject)
    };
  }

  protected constructor(options: {
    project: IdObject<DataModel.Project>;
    run: LoaderRunner;
    forProvider?: (provider: Web3["currentProvider"]) => { run: LoaderRunner }
  }) {
    this.project = options.project;
    this.run = options.run;
    if (options.forProvider) {
      this.forProvider = options.forProvider;
    }
  }
}

export class LiveProject extends Project {
  async loadNetworkForTransaction(
    options: GenerateTransactionNetworkLoadOptions
  ): Promise<{
    network: IdObject<DataModel.Network>
  }> {
    const network = await this.run(generateTranasctionNetworkLoad, options);
    return {
      network: toIdObject(network)
    };
  }
}
