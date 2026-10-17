/** Brand → official registrable domains. Spec section 8. */
export interface Brand {
  name: string;
  domains: readonly string[];
  /** Compact token used to spot the brand inside an unrelated hostname. */
  token: string;
  patterns: readonly RegExp[];
}

export const BRANDS: readonly Brand[] = [
  { name: "Chase", domains: ["chase.com"], token: "chase", patterns: [/\bchase\b/i] },
  {
    name: "USPS",
    domains: ["usps.com"],
    token: "usps",
    patterns: [/\busps\b/i, /u\.s\.\s*postal/i, /united states postal/i],
  },
  {
    name: "IRS",
    domains: ["irs.gov"],
    token: "irs",
    patterns: [/\birs\b/i, /internal revenue/i],
  },
  { name: "Amazon", domains: ["amazon.com"], token: "amazon", patterns: [/\bamazon\b/i] },
  {
    name: "PayPal",
    domains: ["paypal.com"],
    token: "paypal",
    patterns: [/\bpaypal\b/i, /pay\s*pal/i],
  },
  {
    name: "Apple",
    domains: ["apple.com"],
    token: "apple",
    patterns: [/\bapple\b/i, /\bicloud\b/i],
  },
  {
    name: "Bank of America",
    domains: ["bankofamerica.com"],
    token: "bankofamerica",
    patterns: [/bank of america/i, /\bbofa\b/i, /\bbankofamerica\b/i],
  },
  {
    name: "Wells Fargo",
    domains: ["wellsfargo.com"],
    token: "wellsfargo",
    patterns: [/wells fargo/i, /\bwellsfargo\b/i],
  },
  {
    name: "Microsoft",
    domains: ["microsoft.com"],
    token: "microsoft",
    patterns: [/\bmicrosoft\b/i],
  },
  { name: "Netflix", domains: ["netflix.com"], token: "netflix", patterns: [/\bnetflix\b/i] },
  {
    name: "FedEx",
    domains: ["fedex.com"],
    token: "fedex",
    patterns: [/\bfedex\b/i, /fed\s*ex/i],
  },
  { name: "UPS", domains: ["ups.com"], token: "ups", patterns: [/\bUPS\b/] },
  {
    name: "SSA",
    domains: ["ssa.gov"],
    token: "ssa",
    patterns: [/\bssa\b/i, /social security/i],
  },
];

export function brandByName(name: string): Brand | undefined {
  return BRANDS.find((brand) => brand.name.toLowerCase() === name.toLowerCase());
}
