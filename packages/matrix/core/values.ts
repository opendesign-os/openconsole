/**
 * @file 数值辅助：解析 CSS 函数记法里的数字，以及按位数取整。
 *
 * 各命名空间共用，不对外导出。
 */

/**
 * 从 `name(…)` 形式的文本里取出逗号分隔的数字。
 *
 * 不校验个数，个数由调用方的 `from` 负责；文本形如 `matrix(1, 0, 0, 1, 0, 0)`。
 *
 * @param text 完整文本，需已去除首尾空白并转为小写。
 * @param name 函数名，如 `"matrix"`、`"matrix3d"`。
 * @returns 解析出的数字，按出现顺序。
 * @throws {SyntaxError} 文本不是 `name(…)` 形式，或其中含有空项、非有限数。
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
 * 按有效位数取整，消除浮点误差留下的尾数。
 *
 * `-0` 归一为 `0`，避免序列化出 `"-0"`。
 *
 * @param values 原始数值。
 * @param digits 小数位数。
 * @returns 取整后的数值。
 */
export function rounded(values: readonly number[], digits: number): number[] {
  const unit = 10 ** digits;
  return values.map((value) => {
    const result = Math.round(value * unit) / unit;
    return result === 0 ? 0 : result;
  });
}
