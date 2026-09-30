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

export function rounded(values: readonly number[], digits: number): number[] {
  const unit = 10 ** digits;
  return values.map((value) => {
    const result = Math.round(value * unit) / unit;
    return result === 0 ? 0 : result;
  });
}
