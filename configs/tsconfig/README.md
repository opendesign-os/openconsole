# @openconsole/tsconfig

OpenConsole 的 TypeScript 7 配置预设。每个包只继承一个预设,预设之间单链继承,不做数组叠加。

## 预设

| 预设     | 继承   | 内容                                                                                               | 使用方                                       |
| -------- | ------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `base`   | —      | `target: esnext`、`noEmit`、`isolatedModules`、`skipLibCheck`、未使用 / 隐式返回 / switch 贯穿检查 | 其余预设                                     |
| `strict` | `base` | `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`                                           | graph、heap、matrix、plugable、queue、signal |
| `node`   | `base` | `types: ["node"]`                                                                                  | mcp、nacos                                   |
| `react`  | `base` | `jsx: "react-jsx"`                                                                                 | atoms、shadcn                                |

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@openconsole/tsconfig/strict"
}
```

## 为什么这么少

TypeScript 7 的默认值已经覆盖了过去需要显式声明的大部分选项,预设只写与默认值不同的部分:

| 选项                                               | TypeScript 7 默认                          |
| -------------------------------------------------- | ------------------------------------------ |
| `strict`                                           | `true`                                     |
| `module` / `moduleResolution`                      | `esnext` / `bundler`                       |
| `types`                                            | `[]`,全局类型需按预设或包显式声明          |
| `forceConsistentCasingInFileNames`                 | `true`                                     |
| `esModuleInterop` / `allowSyntheticDefaultImports` | 恒为 `true`,不可关闭                       |
| `lib`                                              | 由 `target` 推导;`dom` 已含 `dom.iterable` |

包内 `include` 默认是整个包目录,无需声明;只有目录里另有产物时才显式列出(如 mcp 的 `dist`)。
需要产出文件的包自己覆盖 `noEmit` 并声明输出选项(见 mcp 的 `tsconfig.build.json`)。

## License

MIT
