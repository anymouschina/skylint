import { Command } from "commander";
import { cwd, argv, stdout } from "process";
import { globby } from "globby";
import { readFile, writeFile } from "fs/promises";
import chalk from "chalk";
import pkg from "../package.json";
import { parse } from "./parser";

// WXML rules
import RuleScrollView from "./rules/scroll-view";
// WXSS rules
import RuleBoxSizing from "./rules/box-sizing";
import RuleDisplayFlex from "./rules/display-flex";
import RuleDisplayInline from "./rules/display-inline";
import RuleDisplayInlineBlock from "./rules/display-inline-block";
import RuleNoCalc from "./rules/no-calc";
import RuleNoPseudo from "./rules/no-pseudo";
import RulePositionFixed from "./rules/position-fixed";
// JSON rules
import RuleNoNativeNav from "./rules/no-native-nav";
import RuleDisableScroll from "./rules/disable-scroll";
import RuleRendererSkyline from "./rules/renderer-skyline";

import { RuleLevel, RuleResultItem } from "./rules/interface";
import { format } from "util";
// import { serialize as serializeHTML } from "./serilizer/html";
// import { serialize as serializeCSS } from "./serilizer/css";
// import { serialize as serializeJSON } from "./serilizer/json";

import inquirer from "inquirer";
import { resolve, dirname, relative } from "path";
import { Patch, applyPatchesOnString } from "./patch";
import { existsSync } from "fs";
import { collectImportedWXSS } from "./utils/collect-wxss";

interface ICliOptions {
  path?: string;
  logLevel: number;
}

const Rules = [
  // WXML rules
  RuleScrollView,
  // WXSS rules
  RuleBoxSizing,
  RuleDisplayFlex,
  RuleDisplayInline,
  RuleDisplayInlineBlock,
  RuleNoCalc,
  RuleNoPseudo,
  RulePositionFixed,
  // JSON rules
  RuleNoNativeNav,
  RuleDisableScroll,
  RuleRendererSkyline,
];

const logColor = {
  [RuleLevel.Verbose]: chalk.gray,
  [RuleLevel.Info]: (str?: string) => str,
  [RuleLevel.Warn]: chalk.yellow,
  [RuleLevel.Error]: chalk.red,
};

const cli = new Command();
cli.name(pkg.name);
cli.version(pkg.version);

cli.option("-p, --path [string]", "path to source directory");
cli.option("-l, --log-level [number]", "from 0 to 2", parseInt, 0);

cli.parse(argv);

const options = cli.opts<ICliOptions>();

interface PromptAnswer {
  autoAppJson: boolean;
  appJsonEnableDynamicInjection: boolean;
  globalSkyline: boolean;
  usePageSelector: boolean;
  skylinePages: string[];
}

(async () => {
  let appJsonPath: string = "";
  let appJsonObject: any = null;
  let pageJsonObjects: Record<string, any> = [];

  const getAppJsonFromPath = async (path: string) => {
    try {
      appJsonPath = resolve(path, "app.json");
      const appJsonFile = await readFile(appJsonPath);
      appJsonObject = JSON.parse(appJsonFile.toString());
    } catch (e) {
      return "无效 app.json，请检查路径和语法是否正确";
    }
  };

  if (options.path && existsSync(options.path)) {
    if (!(await getAppJsonFromPath(options.path))) return;
  }

  await inquirer
    .prompt<Record<"path", string>>({
      type: "input",
      name: "path",
      message: "工程的根目录:",
      default: cwd(),
      when: !options.path,
      validate: async (input) => {
        const err = await getAppJsonFromPath(input);
        if (err) return err;
        const pages: string[] = appJsonObject["pages"] ?? [];
        for (const page of pages) {
          const pageJsonPath = resolve(input, page + ".json");
          try {
            const pageJsonFile = await readFile(pageJsonPath);
            const pageJsonObject = JSON.parse(pageJsonFile.toString());
            pageJsonObjects[page] = pageJsonObject;
          } catch (err) {
            return `页面 ${page} 的配置文件不存在`;
          }
        }

        return true;
      },
    })
    .then((answer) => {
      if (answer.path) {
        options.path = answer.path;
      }
    });

  let globalSkyline = appJsonObject["renderer"] === "skyline";

  const answers = await inquirer.prompt<PromptAnswer>([
    {
      type: "confirm",
      name: "autoAppJson",
      message: "自动配置 app.json?",
      default: false,
      when: options.path,
    },
    {
      type: "confirm",
      name: "appJsonEnableDynamicInjection",
      message: "开启按需注入?",
      default: false,
      when: (hash) => {
        return !hash.autoAppJson && appJsonObject["lazyCodeLoading"] !== "requiredCompoents";
      },
    },
    {
      type: "confirm",
      name: "globalSkyline",
      message: "开启全局 Skyline?",
      default: false,
      when: (hash) => {
        return !hash.autoAppJson && appJsonObject["renderer"] !== "skyline";
      },
    },
    {
      type: "confirm",
      name: "usePageSelector",
      message: "使用列表视图选择应用 Skyline 的页面路径？",
      default: true,
      when: (hash) => {
        return !hash.autoAppJson && !globalSkyline;
      },
    },
    {
      type: "checkbox",
      name: "skylinePages",
      message: "应用 Skyline 的页面路径",
      choices: () => Object.keys(pageJsonObjects),
      default: () =>
        Object.entries(pageJsonObjects)
          .filter(([k, v]) => v["renderer"] === "skyline")
          .map(([k]) => k),
      when: (hash) => appJsonObject["renderer"] !== "skyline" && hash.usePageSelector,
    },
    {
      type: "input",
      name: "skylinePages",
      message: "应用 Skyline 的页面路径（使用半角逗号分隔）",
      filter: (input: string | string[]) => {
        if (Array.isArray(input)) return input;
        return input.split(",").map((page) => page.trim());
      },
      validate: (pages: string[]) => {
        for (const page of pages) {
          if (!pageJsonObjects[page]) return `页面 ${page} 不存在`;
        }
        return true;
      },

      default: () =>
        Object.entries(pageJsonObjects)
          .filter(([k, v]) => v["renderer"] === "skyline")
          .map(([k]) => k),
      when: (hash) => appJsonObject["renderer"] !== "skyline" && !hash.usePageSelector,
    },
  ]);

  if (!appJsonObject) return;

  if (answers.globalSkyline) globalSkyline = answers.globalSkyline;

  if (answers.autoAppJson || answers.appJsonEnableDynamicInjection) {
    appJsonObject["lazyCodeLoading"] = "requiredCompoents";
  }

  if (answers.autoAppJson || globalSkyline) {
    appJsonObject["renderer"] = "skyline";
    answers.skylinePages = Object.keys(pageJsonObjects);
  }

  // writeFile(appJsonPath, serializeJSON(appJsonObject));

  const checkList: string[] = [];

  type FileType = "page" | "comp" | "imported";

  const fileMap = new Map<string, FileType>();

  // collect pages
  // const pages: string[] = answers.skylinePages.map((page) => resolve(options.path!, page));
  for (const page of answers.skylinePages) {
    const path = resolve(options.path!, page);
    checkList.push(path);
    fileMap.set(path, "page");
  }
  // collect used components
  // const usedComponents: string[] = [];
  const dfs = async (base: string, obj: any, isDir = false) => {
    const pathDirname = isDir ? base : dirname(base);
    const compList: string[] = Object.values(obj?.["usingComponents"] ?? {});
    for (const comp of compList) {
      const path = resolve(pathDirname, comp);
      if (fileMap.has(path)) continue;
      checkList.push(path);
      fileMap.set(path, "comp");
      const json = JSON.parse((await readFile(`${path}.json`)).toString());
      await dfs(path, json);
    }
  };
  await dfs(options.path!, appJsonObject, true);
  for (const page of answers.skylinePages) {
    const pagePath = resolve(options.path!, page);
    pageJsonObjects[page] && (await dfs(pagePath, pageJsonObjects[page]));
  }

  // collect imported wxss
  const wxssFiles: string[] = [];
  for (const pageOrComp of checkList) {
    // wxssFiles.push(`${pageOrComp}.wxss`);
    wxssFiles.push(...(await globby([`${pageOrComp}.wxss`])));
  }
  const importedWXSS = await collectImportedWXSS(wxssFiles);

  // collet patches
  const stringPatchesMap = new Map<string, { raw: string; patches: Patch[] }>();

  interface ExtendedRuleResultItem extends RuleResultItem {
    name: string;
    filename: string;
  }

  const runOnFile = async (filename: string) => {
    let wxss = "";
    let wxml = "";
    let json = "";
    const raw = (await readFile(filename)).toString();
    if (filename.endsWith("wxss")) {
      wxss = raw;
    } else if (filename.endsWith("wxml")) {
      wxml = raw;
    } else if (filename.endsWith("json")) {
      json = raw;
    }

    const { astWXML, astWXSS, astJSON, ruleResults } = parse({ wxml, wxss, json, Rules });
    const stringPatches: Patch[] = [];

    // const sortedRuleResults = ruleResults.flatMap(ruleResult=>ruleResult.)
    const resultItems: ExtendedRuleResultItem[] = [];

    for (const { patches, results, name } of ruleResults) {
      stringPatches.push(...patches);
      for (const item of results) {
        resultItems.push({
          name,
          filename,
          ...item,
        });
      }
    }

    // if (resultItems.length) stdout.write(format(chalk.bold("\nFile %s\n"), chalk.cyan(filename)));

    resultItems.sort((a, b) => {
      return a.level !== b.level
        ? b.level - a.level
        : a.name !== b.name
        ? a.name.localeCompare(b.name)
        : a.subname.localeCompare(b.subname);
    });

    stringPatchesMap.set(filename, { raw, patches: stringPatches });
    // const patchedString = applyPatchesOnString(fileContent, stringPatches);

    return resultItems;
  };

  const sortResults = (resultItems: ExtendedRuleResultItem[]) =>
    resultItems.sort((a, b) => {
      return a.level !== b.level
        ? b.level - a.level
        : a.name !== b.name
        ? a.name.localeCompare(b.name)
        : a.subname.localeCompare(b.subname);
    });

  const printResults = (resultItems: ExtendedRuleResultItem[]) => {
    let lastName: string | null = null;
    let lastSubname: string | null = null;
    for (const result of resultItems) {
      const { name, level, fixable, filename } = result;
      if (options.logLevel > level) continue;
      const color = logColor[level];
      const { subname, loc, advice, description } = result;
      let filePath = "";
      if (loc) {
        filePath = format("%s:%d:%d", filename, loc.startLn, loc.startCol);
      } else {
        filePath = format("%s", filename);
      }
      if (lastName !== name || lastSubname !== subname) {
        stdout.write(format("@%s %s\n", color(name), description));
        advice && stdout.write(format("💡 %s\n", chalk.gray(advice)));
        fixable && stdout.write(format("🔧 %s\n", chalk.green("自动修复可用")));
      }
      stdout.write(format("  %s\n", filePath));
      lastSubname = subname;
      lastName = name;
    }
  };

  for (const pageOrComp of checkList) {
    const type = fileMap.get(pageOrComp);
    const files = await globby([`${pageOrComp}.(wxss|wxml|json)`]);
    const jobs = files.map((filename) => runOnFile(filename));
    const results = (await Promise.all(jobs)).flat();
    if (results.length) {
      stdout.write(
        format(
          chalk.bold("\n============ %s %s ============\n"),
          type?.toUpperCase(),
          chalk.blue(relative(options.path!, pageOrComp))
        )
      );
      printResults(sortResults(results));
    }
  }

  {
    const jobs = [...importedWXSS].map((filename) => runOnFile(filename));
    const results = (await Promise.all(jobs)).flat();
    if (results.length) {
      stdout.write(format(chalk.bold("\n============ %s ============\n"), "Imported"));
      printResults(sortResults(results));
    }
  }

  stdout.write("\n");
  let tmp = [...stringPatchesMap.values()].map((obj) => obj.patches.length);
  const totalPatchlength = tmp.length ? tmp.reduce((a, b) => a + b) : 0;
  const fixMessage = format(
    "%d 个文件中共有 %d 处问题可以自动修复，是否进行？\n",
    stringPatchesMap.size,
    totalPatchlength
  );

  type FixAnswer = Record<"applyFix", boolean>;

  const fixAnswer = await inquirer.prompt<FixAnswer>([
    {
      type: "confirm",
      name: "applyFix",
      message: fixMessage,
      default: false,
      when: totalPatchlength > 0,
    },
  ]);

  if (fixAnswer.applyFix) {
    for (const [path, { raw, patches }] of stringPatchesMap) {
      const patchedString = applyPatchesOnString(raw, patches);
      await writeFile(path, patchedString.toString());
    }
    stdout.write(chalk.green("✅ 修复完成"));
  }
})().catch((err: Error) => {
  console.error(chalk.blue("❌"), err.message);
});
