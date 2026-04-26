// Australian Business Number (ABN) checksum.
// https://abr.business.gov.au/Help/AbnFormat
//
// TODO: augment with ABR Lookup web service (https://abr.business.gov.au/Tools/WebServices)
// to confirm the ABN is currently active and auto-fill businessName from the
// registered entity name. Blocked on obtaining a Web Services GUID.
export function validateAbnChecksum(abn: string): boolean {
  if (!/^[0-9]{11}$/.test(abn)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const digits = abn.split('').map(Number);
  digits[0] -= 1;
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  return sum % 89 === 0;
}
