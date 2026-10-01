// Version comparisons the app needs, without the semver package: this module
// is used by the first page, and the package would add its whole parser there.
// A version is read the way semver.coerce reads it — the first
// `major[.minor[.patch]]` in the string, each part at most 16 digits — and
// anything semver would reject (leading zeros, unsafe integers) gives null.
type Version = [number, number, number];

const COERCE = /(^|[^\d])(\d{1,16})(?:\.(\d{1,16}))?(?:\.(\d{1,16}))?(?:$|[^\d])/;
const NUMERIC_PART = /^(0|[1-9]\d*)$/;

const normalizeVersion = (version?: string | null): Version | null => {
  if (typeof version !== 'string') return null;

  const match = COERCE.exec(version);
  if (!match) return null;

  const parts = [match[2], match[3] || '0', match[4] || '0'];
  if (!parts.every((part) => NUMERIC_PART.test(part))) return null;

  const numbers = parts.map(Number) as Version;
  return numbers.every(Number.isSafeInteger) ? numbers : null;
};

const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export const semverMajorMinorGt = (versionA, versionB): boolean => {
  const normalizedVersionA = normalizeVersion(versionA);
  const normalizedVersionB = normalizeVersion(versionB);

  if (!normalizedVersionA || !normalizedVersionB) {
    return false;
  }

  return compare(
    [normalizedVersionA[0], normalizedVersionA[1], 0],
    [normalizedVersionB[0], normalizedVersionB[1], 0],
  ) > 0;
};

export const semverGte = (versionA?: string | null, versionB?: string | null): boolean => {
  const normalizedVersionA = normalizeVersion(versionA);
  const normalizedVersionB = normalizeVersion(versionB);

  if (!normalizedVersionA || !normalizedVersionB) {
    return false;
  }

  return compare(normalizedVersionA, normalizedVersionB) >= 0;
};
