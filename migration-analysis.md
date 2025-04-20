# Skylint 迁移工具实现分析

## 1. 整体架构

Skylint 是一个基于规则引擎的代码分析工具，主要用于帮助开发者将普通微信小程序迁移到 Skyline 渲染引擎。其核心实现包括以下几个部分：

### 1.1 核心组件
- **解析器（Parser）**：负责解析 WXML、WXSS 和 JSON 文件
- **规则引擎（Rules）**：定义和实现各种检查规则
- **遍历器（Walker）**：遍历抽象语法树（AST）
- **补丁系统（Patch）**：实现代码自动修复
- **序列化器（Serializer）**：将修改后的 AST 转换回源代码

### 1.2 工作流程
1. 解析源代码文件（WXML、WXSS、JSON）
2. 生成抽象语法树（AST）
3. 应用规则检查
4. 生成修复建议
5. 应用自动修复（可选）
6. 输出结果

## 2. 详细实现

### 2.1 解析器（Parser）
```typescript
// src/parser.ts
export const parse = <T extends BasicParseEnv>(options: IParseOptions<T>) => {
  // 1. 解析 WXML 文件
  if (wxml && !astWXML) {
    astWXML = parseXML(wxml, { xmlMode: true, withStartIndices: true, withEndIndices: true });
  }
  
  // 2. 解析 WXSS 文件
  if (wxss && !astWXSS) {
    astWXSS = parseCSS(wxss, { positions: true });
  }
  
  // 3. 解析 JSON 文件
  if (json && !astJSON) {
    astJSON = parseJSON(json);
  }
  
  // 4. 应用规则检查
  runLifetimeHooks(rules, ast, walker);
  
  // 5. 返回结果
  return { astWXML, astWXSS, astJSON, ruleResults };
};
```

### 2.2 规则系统
规则系统采用插件化设计，每个规则都是一个独立的模块：

```typescript
// src/rules/interface.ts
export interface Rule<T extends RuleType = RuleType> {
  name: string;          // 规则名称
  type: RuleType;        // 规则类型（WXML/WXSS/JSON）
  level: RuleLevel;      // 规则级别（Error/Warn/Info/Verbose）
  before?: () => void;   // 规则执行前的钩子
  onVisit?: HookType[T]; // 访问节点时的钩子
  after?: () => void;    // 规则执行后的钩子
}
```

### 2.3 补丁系统
补丁系统用于实现自动修复：

```typescript
// src/patch/index.ts
export const applyPatchesOnString = (rawString: string, patches: Patch[]) => {
  const str = new MagicString(rawString);
  // 1. 对补丁进行排序
  const sortedPatches = sortPatchesByLoc(patches);
  
  // 2. 应用补丁
  for (const patch of sortedPatches) {
    if (patch.loc.end - patch.loc.start === 0) {
      // 插入补丁
      str.appendRight(patch.loc.start, patch.patchedStr);
    } else {
      // 替换补丁
      str.overwrite(patch.loc.start, patch.loc.end, patch.patchedStr);
    }
  }
  
  return str;
};
```

## 3. 迁移规则实现

### 3.1 页面配置规则
```typescript
// src/rules/disable-scroll/index.ts
export default generateBasicJsonConfigCheck(
  { name: "disable-scroll", type: RuleType.JSON },
  { 
    result: createResultItem({
      name: "disable-scroll",
      description: "不支持页面全局滚动",
      advice: "需将页面配置中的 disableScroll 置为 true",
      level: RuleLevel.Error
    }),
    key: "disableScroll",
    value: true
  }
);
```

### 3.2 组件规则
```typescript
// src/rules/navigator/index.ts
export default defineRule<RuleEnv, RuleType.WXML>(
  { name: "navigator", type: RuleType.WXML },
  (ctx) => {
    ctx.lifetimes({
      onVisit: (node) => {
        // 检查 navigator 组件是否只包含文本
        if (isType(node, "Tag") && node.name === "navigator") {
          const hasNonTextChild = node.children.some(child => !isType(child, "Text"));
          if (hasNonTextChild) {
            ctx.addResult({
              name: "navigator",
              description: "navigator 组件只能嵌套文本",
              level: RuleLevel.Warn
            });
          }
        }
      }
    });
  }
);
```

## 4. 迁移流程

### 4.1 初始化
1. 读取项目配置文件（app.json）
2. 收集需要迁移的页面
3. 配置迁移选项（全局/局部迁移）

### 4.2 分析阶段
1. 解析源代码文件
2. 应用规则检查
3. 生成问题报告

### 4.3 修复阶段
1. 显示问题报告
2. 提供修复建议
3. 执行自动修复（可选）

## 5. 关键技术点

### 5.1 AST 处理
- 使用 htmlparser2 解析 WXML
- 使用 css-tree 解析 WXSS
- 使用 json-to-ast 解析 JSON

### 5.2 代码修改
- 使用 magic-string 进行代码修改
- 支持增量修改
- 处理代码位置信息

### 5.3 错误报告
- 支持代码片段显示
- 提供详细的错误位置
- 分级显示问题严重程度

## 6. 总结

Skylint 通过以下方式实现迁移：

1. **静态分析**：通过解析源代码，构建抽象语法树
2. **规则检查**：定义一系列规则，检查代码是否符合 Skyline 要求
3. **自动修复**：对于可以自动修复的问题，提供一键修复功能
4. **交互式指导**：通过命令行交互，引导用户完成迁移过程

这种实现方式的优点是：
- 自动化程度高
- 可扩展性强
- 修复建议准确
- 用户体验友好

缺点：
- 无法处理动态生成的内容
- 部分复杂场景需要人工干预
- 规则需要持续更新 