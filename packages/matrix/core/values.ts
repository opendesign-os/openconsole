/**
 * @file 数值辅助：解析 CSS 函数记法里的数字、校验定长元组的长度，以及按位数取整。
 *
 * 只供 `plane`、`space` 两个命名空间共用，不从包入口导出。
 */

/**
 * 从 `name(…)` 形式的文本里取出逗号分隔的数字。
 *
 * 只校验记法与每一项都是有限数，不校验个数，个数由调用方的 `from` 负责。
 * 每一项按 `Number()` 转换，前后空白与 `1e-3`、`.5` 之类写法都接受；
 * 空项（如 `matrix(1,,2)`）、带单位的值与 `NaN`、`Infinity` 一律视为非法。
 *
 * @param text 完整文本，需已去除首尾空白并转为小写。
 * @param name 函数名，如 `"matrix"`、`"matrix3d"`。
 * @returns 解析出的数字，按出现顺序。
 * @throws {SyntaxError} 文本不是 `name(…)` 形式，或其中含有空项、非有限数。
 * @example
 * numbers("matrix(1, 0, 0, 1, 10, 20)", "matrix"); // [1, 0, 0, 1, 10, 20]
 * numbers("translate(10px)", "matrix"); // 抛出 SyntaxError
 */
export function numbers(text: string, name: string): number[] {
  const body =
    text.startsWith(`${name}(`) && text.endsWith(")")
      ? text.slice(name.length + 1, -1)
      : "";
  const values = body
    .split(",")
    .map((part) => (part.trim() === "" ? Number.NaN : Number(part)));
  if (!values.every(Number.isFinite)) {
    throw new SyntaxError(`invalid ${name}(): ${text}`);
  }
  return values;
}

/**
 * 判断数组是否恰有定长元组 `T` 的长度，是则把它收窄为 `T`。
 *
 * 矩阵元组的元素都是数，长度对上即可当作 `T` 使用，免去逐项的非空断言。
 *
 * @template T 目标定长元组，如 6 个数的二维仿射矩阵。
 * @param values 待判断的数组。
 * @param length `T` 的长度，类型上必须与 `T["length"]` 一致。
 * @returns 长度相等时为 `true`，`values` 随之收窄为 `T`。
 */
export const sized = <T extends readonly number[]>(
  values: readonly number[],
  length: T["length"],
): values is T => values.length === length;

/**
 * 按小数位数四舍五入，消除浮点误差留下的尾数。
 *
 * 结果中的 `-0` 归一为 `0`，避免序列化出 `"-0"`。
 *
 * @param values 原始数值。
 * @param digits 保留的小数位数。
 * @returns 取整后的新数组，长度与 `values` 相同。
 * @example
 * rounded([0.1 + 0.2, -1e-12], 10); // [0.3, 0]
 */
export function rounded(values: readonly number[], digits: number): number[] {
  const unit = 10 ** digits;
  return values.map((value) => {
    const result = Math.round(value * unit) / unit;
    return result === 0 ? 0 : result;
  });
}
