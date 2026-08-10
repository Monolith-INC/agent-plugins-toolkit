# Extension boundary

The `com.acme.translation` extension namespace carries client-specific translation metadata.

Portable core MUST preserve these fields without interpreting or executing them.
Vendor compilation and host runtimes MAY consume them later; validation and inspection MUST NOT.

Failing components (for example invalid MCP entries in companion fixtures) MUST NOT erase valid manifest, Skill, or sibling MCP results.
