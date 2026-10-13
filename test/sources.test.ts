import { describe, expect, it } from "vitest";
import { canonical, wanted, type Posting } from "../src/sources/index.ts";
import { extractJobs } from "../src/sources/jobright.ts";
import { parseCards } from "../src/sources/linkedin.ts";
import { tsentaJobs } from "../src/sources/tsenta.ts";

const card = (id: string, title: string, company: string, location: string, date: string) => `
  <li>
    <div class="base-card base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:${id}">
      <a class="base-card__full-link" href="https://ca.linkedin.com/jobs/view/x-${id}?position=1"><span class="sr-only">${title}</span></a>
      <div class="base-search-card__info">
        <h3 class="base-search-card__title">
          ${title}
        </h3>
        <h4 class="base-search-card__subtitle">
          <a class="hidden-nested-link" href="https://www.linkedin.com/company/x">
            ${company}
          </a>
        </h4>
        <div class="base-search-card__metadata">
          <span class="job-search-card__location">
            ${location}
          </span>
          <time class="job-search-card__listdate--new" datetime="${date}">18 hours ago</time>
        </div>
      </div>
    </div>
  </li>`;

describe("linkedin search cards", () => {
  it("parses id, title, company, location and date", () => {
    const html = `<!DOCTYPE html>${card("4476851832", "Senior Software Engineer - Mobile Backend", "BitGo", "Toronto, Ontario, Canada", "2026-10-09")}
      ${card("4434013017", "Full Stack Engineer &amp; AI", "Acme &amp; Co", "Vancouver, British Columbia, Canada", "2026-10-10")}
      <li><div>an ad with no job id</div></li>`;
    expect(parseCards(html)).toEqual([
      { url: "https://www.linkedin.com/jobs/view/4476851832/", title: "Senior Software Engineer - Mobile Backend", company: "BitGo",
        location: "Toronto, Ontario, Canada", postedAt: "2026-10-09", source: "linkedin" },
      { url: "https://www.linkedin.com/jobs/view/4434013017/", title: "Full Stack Engineer & AI", company: "Acme & Co",
        location: "Vancouver, British Columbia, Canada", postedAt: "2026-10-10", source: "linkedin" },
    ]);
  });
});

describe("filters", () => {
  const p = (title: string, company = "Acme"): Posting => ({ url: "u", title, company, location: "", source: "linkedin" });
  const s = { skipTitleWords: ["intern", "co-op", "staff", "account executive"], skipCompanies: ["Revature"] };
  it("drops whole title words, case-insensitive", () => {
    expect(wanted(p("Software Engineer Intern"), s)).toBe(false);
    expect(wanted(p("Staff Engineer"), s)).toBe(false);
    expect(wanted(p("Software Developer (Co-op)"), s)).toBe(false);
    expect(wanted(p("Senior Account Executive"), s)).toBe(false);
    expect(wanted(p("Internal Tools Engineer"), s)).toBe(true);
    expect(wanted(p("Staffing Platform Engineer"), s)).toBe(true);
  });
  it("drops skipped companies by substring", () => {
    expect(wanted(p("Software Engineer", "Revature LLC"), s)).toBe(false);
    expect(wanted(p("Software Engineer", "Stripe"), s)).toBe(true);
  });
  it("canonicalizes LinkedIn URLs and drops utm params", () => {
    expect(canonical("https://ca.linkedin.com/jobs/view/senior-engineer-at-bitgo-4476851832?position=1")).toBe("https://www.linkedin.com/jobs/view/4476851832/");
    expect(canonical("https://www.linkedin.com/jobs/search/?currentJobId=123&keywords=x")).toBe("https://www.linkedin.com/jobs/view/123/");
    expect(canonical("https://jobs.lever.co/acme/1?utm_source=jobright&lever-source=x")).toBe("https://jobs.lever.co/acme/1?lever-source=x");
  });
});

describe("jobright job JSON", () => {
  // Shape of /swan/recommend/list/jobs (and the public /swan/recommend/landing/jobs), trimmed.
  const body = {
    success: true,
    errorCode: 10000,
    result: {
      jobList: [
        {
          impId: "0_search_1",
          jobResult: {
            jobId: "6aac655d3dbb1f8967cea7de",
            jobTitle: "Software Development Engineer",
            jobLocation: "Toronto, ON",
            isRemote: false,
            publishTime: "2026-10-10 17:29:52",
            jobSummary: "Build platform services.",
            coreResponsibilities: ["Ship APIs", "Own on-call"],
            applyLink: "https://jobright.ai/jobs/info/6aac655d3dbb1f8967cea7de?utm_source=1014",
            originalUrl: "https://boards.greenhouse.io/acme/jobs/123",
          },
          companyResult: { companyName: "Amazon", leadership: [{ pname: "Someone" }] },
          displayScore: 0.9,
        },
        {
          jobResult: { jobId: "6aca7604e7a1d9333210b98a", jobTitle: "Founding Engineer", isRemote: true, applyLink: "https://jobright.ai/jobs/info/6aca7604e7a1d9333210b98a" },
          companyResult: { companyName: "Tiny AI" },
        },
        { jobResult: { jobTitle: "No id, not a job" }, companyResult: { companyName: "X" } },
      ],
      impId: null,
    },
  };

  it("prefers the employer's apply URL, falls back to the Jobright job page", () => {
    expect(extractJobs(body)).toEqual([
      {
        url: "https://boards.greenhouse.io/acme/jobs/123",
        title: "Software Development Engineer",
        company: "Amazon",
        location: "Toronto, ON",
        postedAt: "2026-10-10 17:29:52",
        source: "jobright",
        description: "Build platform services.\nShip APIs\nOwn on-call",
      },
      {
        url: "https://jobright.ai/jobs/info/6aca7604e7a1d9333210b98a",
        title: "Founding Engineer",
        company: "Tiny AI",
        location: "Remote",
        postedAt: undefined,
        source: "jobright",
        description: undefined,
      },
    ]);
  });

  it("finds flat job arrays anywhere and ignores non-job JSON", () => {
    expect(extractJobs({ data: { items: [{ id: 7, title: "AI Engineer", companyName: "Cohere", location: "Toronto" }] } }))
      .toMatchObject([{ url: "https://jobright.ai/jobs/info/7", title: "AI Engineer", company: "Cohere" }]);
    expect(extractJobs({ success: false, errorCode: 41001, errorMsg: "Cookie not found" })).toEqual([]);
    expect(extractJobs(undefined)).toEqual([]);
  });
});

describe("tsenta feed JSON", () => {
  // Shape of api.autojobs.me/api/v1/jobs/recommendations, trimmed.
  const body = {
    data: [
      {
        id: "28f110cb-79f9-4391-8339-51c9bd597f6c", title: "Senior Software Engineer", companyName: "Marigold",
        companyWebsite: "https://meetmarigold.com", locations: ["Toronto, ON", "Remote"], datePosted: "2026-10-10T14:00:00.000Z",
        matchScore: 82, atsType: "lever", url: "https://jobs.lever.co/marigold/ea312697-dee9-4c08-a5b0-896ad43cfa3b",
        description: "<p>Build &amp; ship.</p>",
      },
      { id: "1e31fdd3-c52c-4050-9704-c988a9abae6d", title: "AI Engineer", companyName: "11x", locations: [], workplaceType: "REMOTE", url: "https://tsenta.com/jobs/x" },
      { id: "no-title", companyName: "Nobody" },
    ],
    pagination: { total: 3, page: 1 },
  };

  it("uses the employer URL as is, falls back to the Tsenta job page", () => {
    expect(tsentaJobs(body)).toEqual([
      {
        url: "https://jobs.lever.co/marigold/ea312697-dee9-4c08-a5b0-896ad43cfa3b", title: "Senior Software Engineer", company: "Marigold",
        location: "Toronto, ON; Remote", postedAt: "2026-10-10T14:00:00.000Z", source: "tsenta", description: "Build & ship.",
      },
      {
        url: "https://tsenta.com/jobs/1e31fdd3-c52c-4050-9704-c988a9abae6d", title: "AI Engineer", company: "11x",
        location: "Remote", postedAt: undefined, source: "tsenta", description: undefined,
      },
    ]);
  });

  it("ignores the 401 body and non-feed JSON", () => {
    expect(tsentaJobs({ message: "Unauthorized: Bearer token is required" })).toEqual([]);
    expect(tsentaJobs(undefined)).toEqual([]);
  });
});
