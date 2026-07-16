interface NormalizedDecimal {
  sign: -1 | 1;
  integer: string;
  fraction: string;
}

function normalizeDecimal(value: unknown): NormalizedDecimal | null {
  const match = String(value).trim().match(/^([+-]?)(\d+)(?:\.(\d*))?$/);
  if (!match) return null;
  const integer = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const zero = integer === "0" && fraction.length === 0;
  return {
    sign: !zero && match[1] === "-" ? -1 : 1,
    integer,
    fraction,
  };
}

function compareAbsolute(left: NormalizedDecimal, right: NormalizedDecimal): number {
  if (left.integer.length !== right.integer.length) {
    return left.integer.length < right.integer.length ? -1 : 1;
  }
  if (left.integer !== right.integer) return left.integer < right.integer ? -1 : 1;
  const width = Math.max(left.fraction.length, right.fraction.length);
  const leftFraction = left.fraction.padEnd(width, "0");
  const rightFraction = right.fraction.padEnd(width, "0");
  if (leftFraction === rightFraction) return 0;
  return leftFraction < rightFraction ? -1 : 1;
}

export function compareExactNumericValues(leftValue: unknown, rightValue: unknown): number {
  const left = normalizeDecimal(leftValue);
  const right = normalizeDecimal(rightValue);
  if (left && right) {
    if (left.sign !== right.sign) return left.sign < right.sign ? -1 : 1;
    return compareAbsolute(left, right) * left.sign;
  }

  const leftNumber = Number(leftValue);
  const rightNumber = Number(rightValue);
  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
    if (leftNumber === rightNumber) return 0;
    return leftNumber < rightNumber ? -1 : 1;
  }
  if (Number.isNaN(leftNumber) && Number.isNaN(rightNumber)) return 0;
  return Number.isNaN(leftNumber) ? 1 : -1;
}
