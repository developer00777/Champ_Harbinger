import "server-only";
import { getUserApiKey } from "@/lib/db/user-keys";
import type {
  Company,
  CompanySearchParams,
  PaginatedResult,
  Person,
  PeopleSearchParams,
} from "./schemas";

// ---------------------------------------------------------------------------
// Mock dataset — 20 fake companies
// ---------------------------------------------------------------------------

const MOCK_COMPANIES: Company[] = [
  {
    id: "mock-001",
    name: "Acuity Analytics",
    domain: "acuityanalytics.io",
    industry: "SaaS",
    employee_count: 45,
    employee_range: "11-50",
    location: { country: "USA", state: "CA", city: "San Francisco" },
    founded_year: 2019,
    funding_stage: "seed",
    funding_total_usd: 3_500_000,
    description: "Revenue intelligence platform for sales teams.",
    technologies: ["Salesforce", "Python", "React"],
    linkedin_url: "https://linkedin.com/company/acuity-analytics",
    website: "https://acuityanalytics.io",
  },
  {
    id: "mock-002",
    name: "BridgeFlow",
    domain: "bridgeflow.com",
    industry: "Fintech",
    employee_count: 120,
    employee_range: "51-200",
    location: { country: "USA", state: "NY", city: "New York" },
    founded_year: 2017,
    funding_stage: "series_a",
    funding_total_usd: 12_000_000,
    description: "API-first payment orchestration for digital businesses.",
    technologies: ["Node.js", "Stripe", "AWS"],
    linkedin_url: "https://linkedin.com/company/bridgeflow",
    website: "https://bridgeflow.com",
  },
  {
    id: "mock-003",
    name: "Ember Health",
    domain: "emberhealth.co",
    industry: "Healthcare",
    employee_count: 28,
    employee_range: "11-50",
    location: { country: "USA", state: "TX", city: "Austin" },
    founded_year: 2021,
    funding_stage: "seed",
    funding_total_usd: 2_200_000,
    description: "Patient communication platform for independent clinics.",
    technologies: ["FHIR", "Twilio", "React"],
    linkedin_url: "https://linkedin.com/company/ember-health",
    website: "https://emberhealth.co",
  },
  {
    id: "mock-004",
    name: "Driftwood Commerce",
    domain: "driftwoodcommerce.com",
    industry: "E-commerce",
    employee_count: 85,
    employee_range: "51-200",
    location: { country: "USA", state: "WA", city: "Seattle" },
    founded_year: 2018,
    funding_stage: "series_a",
    funding_total_usd: 8_000_000,
    description: "Headless commerce infrastructure for modern brands.",
    technologies: ["Next.js", "Contentful", "Shopify"],
    linkedin_url: "https://linkedin.com/company/driftwood-commerce",
    website: "https://driftwoodcommerce.com",
  },
  {
    id: "mock-005",
    name: "Lattice Security",
    domain: "latticesecurity.com",
    industry: "Cybersecurity",
    employee_count: 200,
    employee_range: "51-200",
    location: { country: "USA", state: "MA", city: "Boston" },
    founded_year: 2016,
    funding_stage: "series_b",
    funding_total_usd: 35_000_000,
    description: "Zero-trust network access for distributed enterprises.",
    technologies: ["Kubernetes", "Go", "AWS"],
    linkedin_url: "https://linkedin.com/company/lattice-security",
    website: "https://latticesecurity.com",
  },
  {
    id: "mock-006",
    name: "Novathread",
    domain: "novathread.io",
    industry: "SaaS",
    employee_count: 62,
    employee_range: "51-200",
    location: { country: "USA", state: "IL", city: "Chicago" },
    founded_year: 2020,
    funding_stage: "series_a",
    funding_total_usd: 9_000_000,
    description: "Engineering workflow automation for agile teams.",
    technologies: ["GitHub", "Jira", "Python"],
    linkedin_url: "https://linkedin.com/company/novathread",
    website: "https://novathread.io",
  },
  {
    id: "mock-007",
    name: "Crisp Data",
    domain: "crispdata.ai",
    industry: "Data & Analytics",
    employee_count: 38,
    employee_range: "11-50",
    location: { country: "USA", state: "CO", city: "Denver" },
    founded_year: 2022,
    funding_stage: "seed",
    funding_total_usd: 4_100_000,
    description: "Data quality and observability for operations teams.",
    technologies: ["dbt", "Snowflake", "Python"],
    linkedin_url: "https://linkedin.com/company/crisp-data",
    website: "https://crispdata.ai",
  },
  {
    id: "mock-008",
    name: "Halo Logistics",
    domain: "halologistics.com",
    industry: "Supply Chain",
    employee_count: 310,
    employee_range: "201-500",
    location: { country: "USA", state: "TX", city: "Dallas" },
    founded_year: 2015,
    funding_stage: "series_b",
    funding_total_usd: 42_000_000,
    description: "Last-mile delivery optimization for retailers and 3PLs.",
    technologies: ["Route optimization", "AWS", "Java"],
    linkedin_url: "https://linkedin.com/company/halo-logistics",
    website: "https://halologistics.com",
  },
  {
    id: "mock-009",
    name: "Meridian AI",
    domain: "meridianai.co",
    industry: "AI/ML",
    employee_count: 55,
    employee_range: "51-200",
    location: { country: "USA", state: "CA", city: "San Francisco" },
    founded_year: 2021,
    funding_stage: "series_a",
    funding_total_usd: 15_000_000,
    description: "LLM fine-tuning platform for enterprise teams.",
    technologies: ["PyTorch", "CUDA", "Python"],
    linkedin_url: "https://linkedin.com/company/meridian-ai",
    website: "https://meridianai.co",
  },
  {
    id: "mock-010",
    name: "Sunbeam EdTech",
    domain: "sunbeamedtech.com",
    industry: "EdTech",
    employee_count: 90,
    employee_range: "51-200",
    location: { country: "USA", state: "NY", city: "New York" },
    founded_year: 2019,
    funding_stage: "series_a",
    funding_total_usd: 11_000_000,
    description: "Corporate L&D platform for upskilling workforces.",
    technologies: ["React", "LMS", "Zoom"],
    linkedin_url: "https://linkedin.com/company/sunbeam-edtech",
    website: "https://sunbeamedtech.com",
  },
  {
    id: "mock-011",
    name: "Cobalt HR",
    domain: "cobalthr.com",
    industry: "HR Tech",
    employee_count: 140,
    employee_range: "51-200",
    location: { country: "UK", state: "England", city: "London" },
    founded_year: 2018,
    funding_stage: "series_b",
    funding_total_usd: 22_000_000,
    description: "Employee engagement and retention platform for mid-market.",
    technologies: ["Workday", "Slack", "React"],
    linkedin_url: "https://linkedin.com/company/cobalt-hr",
    website: "https://cobalthr.com",
  },
  {
    id: "mock-012",
    name: "Vesper Cloud",
    domain: "vespercloud.eu",
    industry: "SaaS",
    employee_count: 75,
    employee_range: "51-200",
    location: { country: "Germany", state: "Berlin", city: "Berlin" },
    founded_year: 2020,
    funding_stage: "seed",
    funding_total_usd: 5_000_000,
    description: "EU data sovereignty platform for GDPR-compliant SaaS.",
    technologies: ["AWS EU", "Terraform", "Go"],
    linkedin_url: "https://linkedin.com/company/vesper-cloud",
    website: "https://vespercloud.eu",
  },
  {
    id: "mock-013",
    name: "Axle Insurance",
    domain: "axleinsurance.com",
    industry: "Insurtech",
    employee_count: 160,
    employee_range: "51-200",
    location: { country: "USA", state: "IL", city: "Chicago" },
    founded_year: 2017,
    funding_stage: "series_b",
    funding_total_usd: 28_000_000,
    description: "Commercial insurance API for embedded coverage products.",
    technologies: ["Python", "AWS", "Stripe"],
    linkedin_url: "https://linkedin.com/company/axle-insurance",
    website: "https://axleinsurance.com",
  },
  {
    id: "mock-014",
    name: "Prism Analytics",
    domain: "prismanalytics.io",
    industry: "SaaS",
    employee_count: 33,
    employee_range: "11-50",
    location: { country: "USA", state: "TX", city: "Austin" },
    founded_year: 2022,
    funding_stage: "seed",
    funding_total_usd: 3_000_000,
    description: "Product usage analytics for B2B SaaS companies.",
    technologies: ["Segment", "React", "Node.js"],
    linkedin_url: "https://linkedin.com/company/prism-analytics",
    website: "https://prismanalytics.io",
  },
  {
    id: "mock-015",
    name: "Glean Procurement",
    domain: "gleanprocurement.com",
    industry: "B2B Marketplace",
    employee_count: 420,
    employee_range: "201-500",
    location: { country: "USA", state: "CA", city: "San Francisco" },
    founded_year: 2016,
    funding_stage: "series_c",
    funding_total_usd: 65_000_000,
    description: "Enterprise procurement marketplace for Fortune 1000.",
    technologies: ["Salesforce", "SAP", "React"],
    linkedin_url: "https://linkedin.com/company/glean-procurement",
    website: "https://gleanprocurement.com",
  },
  {
    id: "mock-016",
    name: "Foundry Manufacturing",
    domain: "foundrymfg.com",
    industry: "Manufacturing",
    employee_count: 250,
    employee_range: "201-500",
    location: { country: "USA", state: "MI", city: "Detroit" },
    founded_year: 2014,
    funding_stage: "series_b",
    funding_total_usd: 30_000_000,
    description: "IoT-powered production intelligence for factory floors.",
    technologies: ["IoT", "AWS IoT", "Python"],
    linkedin_url: "https://linkedin.com/company/foundry-manufacturing",
    website: "https://foundrymfg.com",
  },
  {
    id: "mock-017",
    name: "NimbleOps",
    domain: "nimbleops.dev",
    industry: "DevOps/SaaS",
    employee_count: 48,
    employee_range: "11-50",
    location: { country: "USA", state: "MA", city: "Boston" },
    founded_year: 2021,
    funding_stage: "seed",
    funding_total_usd: 3_800_000,
    description: "Incident management and on-call scheduling for DevOps teams.",
    technologies: ["PagerDuty", "Slack", "Go"],
    linkedin_url: "https://linkedin.com/company/nimbleops",
    website: "https://nimbleops.dev",
  },
  {
    id: "mock-018",
    name: "Cascade Finance",
    domain: "cascadefinance.com",
    industry: "Fintech",
    employee_count: 95,
    employee_range: "51-200",
    location: { country: "USA", state: "NY", city: "New York" },
    founded_year: 2020,
    funding_stage: "series_a",
    funding_total_usd: 14_000_000,
    description: "SMB lending platform powered by real-time cash flow data.",
    technologies: ["Plaid", "Python", "AWS"],
    linkedin_url: "https://linkedin.com/company/cascade-finance",
    website: "https://cascadefinance.com",
  },
  {
    id: "mock-019",
    name: "Thornbrook Legal",
    domain: "thornbrooklegal.com",
    industry: "LegalTech",
    employee_count: 42,
    employee_range: "11-50",
    location: { country: "USA", state: "DC", city: "Washington" },
    founded_year: 2021,
    funding_stage: "seed",
    funding_total_usd: 2_800_000,
    description: "Contract lifecycle management for in-house legal teams.",
    technologies: ["DocuSign", "GPT-4", "React"],
    linkedin_url: "https://linkedin.com/company/thornbrook-legal",
    website: "https://thornbrooklegal.com",
  },
  {
    id: "mock-020",
    name: "Apex Recruiting",
    domain: "apexrecruiting.com",
    industry: "HR Tech",
    employee_count: 180,
    employee_range: "51-200",
    location: { country: "USA", state: "TX", city: "Austin" },
    founded_year: 2017,
    funding_stage: "series_b",
    funding_total_usd: 25_000_000,
    description: "Talent acquisition platform for high-growth companies.",
    technologies: ["Greenhouse", "LinkedIn", "React"],
    linkedin_url: "https://linkedin.com/company/apex-recruiting",
    website: "https://apexrecruiting.com",
  },
];

// ---------------------------------------------------------------------------
// Mock people dataset — minimal set tied to mock companies
// ---------------------------------------------------------------------------

const MOCK_PEOPLE: Person[] = [
  {
    id: "mock-p-001",
    first_name: "Sarah",
    last_name: "Chen",
    full_name: "Sarah Chen",
    title: "CEO",
    company_id: "mock-001",
    company_name: "Acuity Analytics",
    email: "sarah.chen@acuityanalytics.io",
    linkedin_url: "https://linkedin.com/in/sarah-chen",
    location: { country: "USA", state: "CA", city: "San Francisco" },
  },
  {
    id: "mock-p-002",
    first_name: "James",
    last_name: "Alvarez",
    full_name: "James Alvarez",
    title: "VP of Engineering",
    company_id: "mock-002",
    company_name: "BridgeFlow",
    email: "james.alvarez@bridgeflow.com",
    linkedin_url: "https://linkedin.com/in/james-alvarez",
    location: { country: "USA", state: "NY", city: "New York" },
  },
  {
    id: "mock-p-003",
    first_name: "Priya",
    last_name: "Nair",
    full_name: "Priya Nair",
    title: "Head of Product",
    company_id: "mock-009",
    company_name: "Meridian AI",
    email: "priya.nair@meridianai.co",
    linkedin_url: "https://linkedin.com/in/priya-nair",
    location: { country: "USA", state: "CA", city: "San Francisco" },
  },
];

// ---------------------------------------------------------------------------
// Helper: normalise a string-or-array filter to an array
// ---------------------------------------------------------------------------

function toArray(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

function matchesAny(value: string | undefined, filters: string[]): boolean {
  if (!value) return false;
  return filters.some((f) => value.toLowerCase().includes(f.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Mock filtering
// ---------------------------------------------------------------------------

function filterCompanies(
  companies: Company[],
  params: CompanySearchParams,
): Company[] {
  const industryFilters = toArray(params.industry);
  const countryFilters = toArray(params.country);
  const fundingFilters = toArray(params.funding_stage);

  return companies.filter((c) => {
    // q: name substring match
    if (params.q && !c.name.toLowerCase().includes(params.q.toLowerCase())) {
      return false;
    }

    // industry
    if (industryFilters && !matchesAny(c.industry, industryFilters)) {
      return false;
    }

    // employee range
    if (
      params.employee_min !== undefined &&
      (c.employee_count ?? 0) < params.employee_min
    ) {
      return false;
    }
    if (
      params.employee_max !== undefined &&
      (c.employee_count ?? Infinity) > params.employee_max
    ) {
      return false;
    }

    // funding_stage
    if (fundingFilters && !matchesAny(c.funding_stage, fundingFilters)) {
      return false;
    }

    // country
    if (countryFilters && !matchesAny(c.location?.country, countryFilters)) {
      return false;
    }

    return true;
  });
}

function filterPeople(people: Person[], params: PeopleSearchParams): Person[] {
  const countryFilters = toArray(params.country);

  return people.filter((p) => {
    // q: full_name substring match
    if (
      params.q &&
      !p.full_name.toLowerCase().includes(params.q.toLowerCase())
    ) {
      return false;
    }

    // company_id
    if (params.company_id && p.company_id !== params.company_id) {
      return false;
    }

    // country
    if (countryFilters && !matchesAny(p.location?.country, countryFilters)) {
      return false;
    }

    return true;
  });
}

function paginate<T>(
  items: T[],
  page: number,
  perPage: number,
): PaginatedResult<T> {
  const start = (page - 1) * perPage;
  const results = items.slice(start, start + perPage);
  return {
    results,
    total: items.length,
    page,
    per_page: perPage,
    has_more: start + perPage < items.length,
  };
}

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

export interface LakeB2BClient {
  searchCompanies(
    params: CompanySearchParams,
  ): Promise<PaginatedResult<Company>>;
  searchPeople(params: PeopleSearchParams): Promise<PaginatedResult<Person>>;
}

// ---------------------------------------------------------------------------
// Mock client
// ---------------------------------------------------------------------------

function createMockClient(): LakeB2BClient {
  return {
    async searchCompanies(params: CompanySearchParams) {
      let filtered = filterCompanies(MOCK_COMPANIES, params);
      // Fallback: if all filters produce 0 results, return first 10
      if (filtered.length === 0) {
        filtered = MOCK_COMPANIES.slice(0, 10);
      }
      return paginate(filtered, params.page, params.per_page);
    },

    async searchPeople(params: PeopleSearchParams) {
      let filtered = filterPeople(MOCK_PEOPLE, params);
      if (filtered.length === 0) {
        filtered = MOCK_PEOPLE.slice(0, 10);
      }
      return paginate(filtered, params.page, params.per_page);
    },
  };
}

// ---------------------------------------------------------------------------
// Live client
// ---------------------------------------------------------------------------

function createLiveClient(apiKey: string, baseUrl: string): LakeB2BClient {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  return {
    async searchCompanies(params: CompanySearchParams) {
      const res = await fetch(`${baseUrl}/v1/search/companies`, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        throw new Error(
          `LakeB2B searchCompanies failed: ${res.status} ${res.statusText}`,
        );
      }
      return res.json() as Promise<PaginatedResult<Company>>;
    },

    async searchPeople(params: PeopleSearchParams) {
      const res = await fetch(`${baseUrl}/v1/search/people`, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        throw new Error(
          `LakeB2B searchPeople failed: ${res.status} ${res.statusText}`,
        );
      }
      return res.json() as Promise<PaginatedResult<Person>>;
    },
  };
}

// ---------------------------------------------------------------------------
// Public factory functions
// ---------------------------------------------------------------------------

export function createLakeB2BClient(apiKey: string): LakeB2BClient {
  const baseUrl = process.env.LAKEB2B_API_URL;
  const mockMode = process.env.LAKEB2B_MOCK === "true" || !baseUrl;

  if (mockMode) {
    return createMockClient();
  }

  return createLiveClient(apiKey, baseUrl);
}

export async function getLakeB2BClient(
  clerkUserId?: string,
): Promise<LakeB2BClient> {
  let apiKey: string | null = null;

  if (clerkUserId) {
    apiKey = await getUserApiKey(
      "lakeb2b_api_key",
      clerkUserId,
      process.env.LAKEB2B_API_KEY,
    );
  } else {
    apiKey = process.env.LAKEB2B_API_KEY ?? null;
  }

  return createLakeB2BClient(apiKey ?? "");
}

/**
 * True only when LakeB2B is configured for REAL use (a live API URL + a resolved
 * key, and mock mode off). Used by discovery to prefer LakeB2B over public web.
 */
export async function hasLakeB2BKey(clerkUserId?: string): Promise<boolean> {
  if (process.env.LAKEB2B_MOCK === "true") return false;
  if (!process.env.LAKEB2B_API_URL) return false;
  const apiKey = clerkUserId
    ? await getUserApiKey(
        "lakeb2b_api_key",
        clerkUserId,
        process.env.LAKEB2B_API_KEY,
      )
    : (process.env.LAKEB2B_API_KEY ?? null);
  return Boolean(apiKey);
}
