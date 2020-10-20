import { DocumentNode } from "graphql";
import { WorkflowCompileResult } from "@truffle/compile-common";

import { toIdObject, IdObject } from "@truffle/db/meta";

import {
  generateCompileLoad,
  generateInitializeLoad,
  generateNamesLoad
} from "./commands";

import { LoaderRunner, forDb } from "./run";

interface ITruffleDB {
  query: (query: DocumentNode | string, variables: any) => Promise<any>;
}

export interface InitializeOptions {
  project: DataModel.ProjectInput;
  db: ITruffleDB;
}

export class Project {
  private run: LoaderRunner;
  private project: IdObject<DataModel.Project>;

  static async initialize(options: InitializeOptions): Promise<Project> {
    const { db, project: input } = options;

    const run = forDb(db);

    const project = await run(generateInitializeLoad, input);

    return new Project({ run, project });
  }

  get id() {
    return this.project.id;
  }

  async loadCompilations(options: {
    result: WorkflowCompileResult;
  }): Promise<{
    compilations: IdObject<DataModel.Compilation>[];
    contracts: IdObject<DataModel.Contract>[];
  }> {
    const { result } = options;

    const { compilations, contracts } = await this.run(
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
  }) {
    return await this.run(generateNamesLoad, this.project, options.assignments);
  }

  private constructor(options: {
    project: IdObject<DataModel.Project>;
    run: LoaderRunner;
  }) {
    this.project = options.project;
    this.run = options.run;
  }
}
