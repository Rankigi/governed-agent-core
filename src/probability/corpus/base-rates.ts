export const BASE_RATES: {
  domain: string;
  action_type: string;
  historical_success_rate: number;
  sample_count: number;
}[] = [
  // Finance
  { domain: "finance", action_type: "calculator", historical_success_rate: 0.94, sample_count: 500 },
  { domain: "finance", action_type: "web_search", historical_success_rate: 0.81, sample_count: 300 },
  { domain: "finance", action_type: "data_retrieval", historical_success_rate: 0.88, sample_count: 400 },

  // Governance
  { domain: "governance", action_type: "policy_check", historical_success_rate: 0.97, sample_count: 600 },
  { domain: "governance", action_type: "chain_verify", historical_success_rate: 0.99, sample_count: 800 },
  { domain: "governance", action_type: "anomaly_detect", historical_success_rate: 0.76, sample_count: 200 },

  // Research
  { domain: "research", action_type: "web_search", historical_success_rate: 0.85, sample_count: 400 },
  { domain: "research", action_type: "summarize", historical_success_rate: 0.91, sample_count: 350 },
  { domain: "research", action_type: "fact_check", historical_success_rate: 0.79, sample_count: 250 },

  // Engineering
  { domain: "engineering", action_type: "debug", historical_success_rate: 0.71, sample_count: 300 },
  { domain: "engineering", action_type: "code_review", historical_success_rate: 0.88, sample_count: 450 },
  { domain: "engineering", action_type: "test_run", historical_success_rate: 0.93, sample_count: 500 },

  // Communication
  { domain: "communication", action_type: "draft", historical_success_rate: 0.89, sample_count: 350 },
  { domain: "communication", action_type: "summarize", historical_success_rate: 0.92, sample_count: 400 },
  { domain: "communication", action_type: "translate", historical_success_rate: 0.95, sample_count: 300 },
];
