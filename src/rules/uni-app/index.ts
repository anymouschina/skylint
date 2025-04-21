import { defineRule, RuleType, createResultItem, RuleLevel } from "../interface";
import { isType } from "src/walker/html";
import { isType as isTypeCSS } from "src/walker/css";
import { DomUtils } from "src/walker/html";
import { getLocationByNode } from "src/utils/dom-ast";

// 检查 uni-app 特有的组件和属性
const resultUniAppComponent = createResultItem({
  name: "uni-app-component",
  description: "uni-app 特有组件需要特殊处理",
  advice: "请检查该组件在 Skyline 下的兼容性，可能需要使用原生组件替代",
  level: RuleLevel.Warn,
});

// 检查 uni-app 特有的样式
const resultUniAppStyle = createResultItem({
  name: "uni-app-style",
  description: "uni-app 特有样式需要特殊处理",
  advice: "请检查该样式在 Skyline 下的兼容性，可能需要使用原生样式替代",
  level: RuleLevel.Warn,
});

// uni-app 特有的组件列表
const uniAppComponents = new Set([
  "uni-button",
  "uni-checkbox",
  "uni-radio",
  "uni-input",
  "uni-textarea",
  "uni-swiper",
  "uni-swiper-item",
  "uni-scroll-view",
  "uni-list",
  "uni-list-item",
  "uni-nav-bar",
  "uni-tab-bar",
  "uni-tab-bar-item",
  "uni-popup",
  "uni-transition",
]);

// uni-app 特有的样式前缀
const uniAppStylePrefixes = new Set([
  "uni-",
  "u-",
]);

export default defineRule(
  { name: "uni-app", type: RuleType.WXML },
  (ctx) => {
    ctx.lifetimes({
      onVisit: (node) => {
        if (isType(node, "Tag")) {
          // 检查 uni-app 特有组件
          if (uniAppComponents.has(node.name)) {
            const { start, end, path } = getLocationByNode(node);
            ctx.addResult({
              ...resultUniAppComponent,
              loc: {
                startIndex: start!,
                endIndex: end!,
                path,
              },
            });
          }

          // 检查 uni-app 特有的属性
          for (const [attr, value] of Object.entries(node.attribs)) {
            if (attr.startsWith("uni-") || attr.startsWith("u-")) {
              const { start, end, path } = getLocationByNode(node);
              ctx.addResult({
                ...resultUniAppComponent,
                description: `uni-app 特有属性 ${attr} 需要特殊处理`,
                advice: `请检查该属性在 Skyline 下的兼容性，可能需要使用原生属性替代`,
                loc: {
                  startIndex: start!,
                  endIndex: end!,
                  path,
                },
              });
            }
          }
        }
      },
    });
  }
);

// 检查 uni-app 特有的样式
export const uniAppStyleRule = defineRule(
  { name: "uni-app-style", type: RuleType.WXSS },
  (ctx) => {
    ctx.lifetimes({
      onVisit: (node) => {
        if (isTypeCSS(node, "Declaration")) {
          // 检查 uni-app 特有的样式
          for (const prefix of uniAppStylePrefixes) {
            if (node.property.startsWith(prefix)) {
              const loc = node.loc!;
              ctx.addResult({
                ...resultUniAppStyle,
                description: `uni-app 特有样式 ${node.property} 需要特殊处理`,
                advice: `请检查该样式在 Skyline 下的兼容性，可能需要使用原生样式替代`,
                loc: {
                  startLn: loc.start.line,
                  endLn: loc.end.line,
                  startCol: loc.start.column,
                  endCol: loc.end.column,
                  path: ctx.env.path,
                },
              });
            }
          }
        }
      },
    });
  }
); 