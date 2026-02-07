
import { createRegistrationCode } from "../extensions/custom-app/src/auth-store.js";
import { getCustomAppRuntime } from "../extensions/custom-app/src/runtime.js";

// Initialize the runtime to access config
// Note: This script is intended to be run with `node --import tsx ...`

const INITIAL_CODE = "ADMIN888";

async function main() {
    console.log("Initializing default registration code...");

    // Create a default registration code that gives access to all agents
    // We hardcode the agent IDs for now based on what we know exists
    const agents = ["normal_agent", "xiaomei_agent", "lsp_agent"];

    try {
        createRegistrationCode(INITIAL_CODE, agents, 999, "Admin Default");
        console.log(`✅ Registration code '${INITIAL_CODE}' created successfully!`);
        console.log(`   Agents: ${agents.join(", ")}`);
        console.log(`   Max Uses: 999`);
    } catch (err) {
        console.error("❌ Failed to create registration code:", err);
    }
}

main().catch(console.error);
