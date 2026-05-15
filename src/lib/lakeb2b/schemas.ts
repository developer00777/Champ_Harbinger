import { z } from "zod";

export const CompanySearchParamsSchema = z.object({
  q: z.string().optional(),
  industry: z.union([z.string(), z.array(z.string())]).optional(),
  country: z.union([z.string(), z.array(z.string())]).optional(),
  state: z.union([z.string(), z.array(z.string())]).optional(),
  city: z.union([z.string(), z.array(z.string())]).optional(),
  employee_min: z.number().int().optional(),
  employee_max: z.number().int().optional(),
  funding_stage: z.union([z.string(), z.array(z.string())]).optional(),
  funding_min_usd: z.number().optional(),
  funding_max_usd: z.number().optional(),
  technologies: z.union([z.string(), z.array(z.string())]).optional(),
  founded_after: z.string().optional(),
  founded_before: z.string().optional(),
  page: z.number().int().default(1),
  per_page: z.number().int().max(100).default(25),
});
export type CompanySearchParams = z.infer<typeof CompanySearchParamsSchema>;

export const CompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().optional(),
  industry: z.string().optional(),
  employee_count: z.number().optional(),
  employee_range: z.string().optional(),
  location: z
    .object({
      country: z.string().optional(),
      state: z.string().optional(),
      city: z.string().optional(),
    })
    .optional(),
  founded_year: z.number().optional(),
  funding_stage: z.string().optional(),
  funding_total_usd: z.number().optional(),
  description: z.string().optional(),
  technologies: z.array(z.string()).optional(),
  linkedin_url: z.string().optional(),
  website: z.string().optional(),
});
export type Company = z.infer<typeof CompanySchema>;

export const PeopleSearchParamsSchema = z.object({
  q: z.string().optional(),
  company_id: z.string().optional(),
  title: z.union([z.string(), z.array(z.string())]).optional(),
  seniority: z.union([z.string(), z.array(z.string())]).optional(),
  department: z.union([z.string(), z.array(z.string())]).optional(),
  country: z.union([z.string(), z.array(z.string())]).optional(),
  company_industry: z.union([z.string(), z.array(z.string())]).optional(),
  company_employee_min: z.number().int().optional(),
  company_employee_max: z.number().int().optional(),
  page: z.number().int().default(1),
  per_page: z.number().int().max(100).default(25),
});
export type PeopleSearchParams = z.infer<typeof PeopleSearchParamsSchema>;

export const PersonSchema = z.object({
  id: z.string(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  full_name: z.string(),
  title: z.string().optional(),
  company_id: z.string().optional(),
  company_name: z.string().optional(),
  email: z.string().optional(),
  linkedin_url: z.string().optional(),
  location: z
    .object({
      country: z.string().optional(),
      state: z.string().optional(),
      city: z.string().optional(),
    })
    .optional(),
});
export type Person = z.infer<typeof PersonSchema>;

export type PaginatedResult<T> = {
  results: T[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
};
