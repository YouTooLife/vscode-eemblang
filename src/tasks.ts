import * as vscode from "vscode";
import * as toolchain from "./toolchain";
import { Config } from "./config";
import * as os from "os";
import { log } from "./util";


export const TASK_TYPE = "eec";
export const TASK_SOURCE = "eemblang";

import * as path from "path";
import { fstat } from "fs";
import { rejects } from "assert";

import * as nodePath from 'path';
import { openStdin } from "process";

const posixPath = nodePath.posix || nodePath;

export interface EasyTaskDefinition extends vscode.TaskDefinition {
    command?: string;
    args?: string[];
    cwd?: string;
    env?: { [key: string]: string };
    overrideEasy?: string;
}

class EasyTaskProvider implements vscode.TaskProvider {
    private readonly config: Config;

    constructor(config: Config) {
        this.config = config;
    }

    async provideTasks(): Promise<vscode.Task[]> {
        // Detect Rust tasks. Currently we do not do any actual detection
        // of tasks (e.g. aliases in .cargo/config) and just return a fixed
        // set of tasks that always exist. These tasks cannot be removed in
        // tasks.json - only tweaked.

        const defs = [
            //{ command: "-target thumbv7m-none-none-eabi -S -emit-llvm -g -O3", group: vscode.TaskGroup.Build },
            // { command: "check", group: vscode.TaskGroup.Build },
            // { command: "simulate", group: vscode.TaskGroup.Build },
            // { command: "clippy", group: vscode.TaskGroup.Build },
            // { command: "test", group: vscode.TaskGroup.Test },
            //{ command: "flush", name: "Flush program to device", args: [], undefined },
            { command: "build", name: "Build for Device", args: ["-target", "thumbv7m-none-none-eabi", "-emit-llvm", "-g", "-O3"], group: vscode.TaskGroup.Build },
            { command: "simulate", name: "Run Simulator", args: ["-jit", "-S", "-emit-llvm", "-g", "-O3"], group: undefined },
        ];

        const tasks: vscode.Task[] = [];
        for (const workspaceTarget of vscode.workspace.workspaceFolders || []) {
            for (const def of defs) {
                let args0 = [`${workspaceTarget.uri.fsPath}/main.es`].concat(def.args);
                const vscodeTask = await buildEasyTask(
                    workspaceTarget,
                    { type: TASK_TYPE, command: def.command, args: args0 },
                    def.name,
                    args0,
                    this.config.easyRunner
                );
                vscodeTask.group = def.group;
                tasks.push(vscodeTask);
            }
        }

        return tasks;
    }

    async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
        // VSCode calls this for every cargo task in the user's tasks.json,
        // we need to inform VSCode how to execute that command by creating
        // a ShellExecution for it.

        const definition = task.definition as EasyTaskDefinition;

        // let args = definition.args ?? [""]



        // let uri = vscode.Uri.file(args[0]);

        // vscode.workspace.fs.stat(uri).then(() => {
        //     if (uri.fsPath.search(".es") == -1)
        //     {
        //         vscode.window.showInformationMessage(`Can't compile file '${args[0]}'`);
        //         return undefined;
        //     }
        // }, 
        // () => {
        //     vscode.window.showInformationMessage(`Can't compile file '${args[0]}'`);
        //     return undefined;
        // });

        //let command = definition.command?

        if (definition.type === TASK_TYPE && definition.command) {
            //const args = [definition.command].concat(definition.args ?? []);
            //const args = ${"file"};
            return await buildEasyTask(
                task.scope,
                definition,
                task.name,
                definition.args ?? [],
                this.config.easyRunner
            );
        }

        return undefined;
    }
}

export async function buildEasyTask(
    scope: vscode.WorkspaceFolder | vscode.TaskScope | undefined,
    definition: EasyTaskDefinition,
    name: string,
    args: string[],
    customRunner?: string,
    throwOnError: boolean = false
): Promise<vscode.Task> {
    let exec: vscode.ProcessExecution | vscode.ShellExecution | undefined = undefined;


    if (!exec) {
        // Check whether we must use a user-defined substitute for cargo.
        // Split on spaces to allow overrides like "wrapper cargo".
        const overrideEasy= definition.overrideEasy ?? definition.overrideEasy;
        const easyPath = await toolchain.easyPath();
        const easyCommand = overrideEasy?.split(" ") ?? [easyPath];


        const index = args.indexOf("-o", 0);
        if (index == -1) {
            let uri = vscode.Uri.file(args[0]);
            let path = "";
            try {
                let stat = (await vscode.workspace.fs.stat(uri));
                if (stat.type == vscode.FileType.File) {
                    path = posixPath.dirname(uri.path);
                    path = path.concat("/out/output");
                    if (os.type() === "Windows_NT" && path[0] == '/') {
                        path = path.slice(1);
                    }
                }
                else {
                    path = args[0].concat("/out/output");
                }
            } catch {
                vscode.window.showErrorMessage(`Can't compile file '${args[0]}'`);
                return new Promise(function(resolve, reject) {
                    reject("Error");
                });
            }
            args = args.concat(["-o", path]);
            uri = vscode.Uri.file(posixPath.dirname(path));
            (await (vscode.workspace.fs.stat(uri)).then(()=>{}, () => {
                vscode.workspace.fs.createDirectory(uri);
            }));
        }

        const fullCommand = [...easyCommand, ...args];

        exec = new vscode.ProcessExecution(fullCommand[0], fullCommand.slice(1), definition);
    }

    return new vscode.Task(
        definition,
        // scope can sometimes be undefined. in these situations we default to the workspace taskscope as
        // recommended by the official docs: https://code.visualstudio.com/api/extension-guides/task-provider#task-provider)
        scope ?? vscode.TaskScope.Workspace,
        name,
        TASK_SOURCE,
        exec,
        ["$eec"]
    );
}

export function activateTaskProvider(config: Config): vscode.Disposable {
    const provider = new EasyTaskProvider(config);
    return vscode.tasks.registerTaskProvider(TASK_TYPE, provider);
}