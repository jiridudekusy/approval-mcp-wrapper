# Runtime Dependency Admission

Every direct runtime dependency requires a record containing:

- exact admitted version;
- latest release date at admission time;
- weekly npm downloads;
- maintainers and repository activity;
- direct runtime dependency count;
- license;
- GitHub Advisory Database, OSV, and npm audit result;
- reason Node.js built-ins are insufficient.

The lockfile and admission records are reviewed together. High or critical
runtime advisories block CI.
