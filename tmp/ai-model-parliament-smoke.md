# AI model parliament

- Generated at: `2026-03-22T09:22:01.758Z`
- Runtime: `http://127.0.0.1:9`
- Readiness: `hold`
- Baseline: `qwen3.5:35b-a3b`
- Challengers kept: none
- Recommended prune: none

## Rationale

No model passed both the shared-contract chamber and the Smart Import chamber, so pruning is held and the output stays advisory only. Keep `qwen3.5:35b-a3b` as the protected provisional baseline until Smart Import thresholds are met.

## Protected models

- `deepseek-ocr`
- `qwen2.5:32b`
- `qwen3.5:35b-a3b`

## Candidate verdicts

| Candidate | Runtime model | Verdict | Contract chamber | Smart Import chamber |
| --- | --- | --- | --- | --- |
| Qwen2.5 32B | `qwen2.5:32b` | `protected_active` | No completed shared-contract benchmark available. | No completed smart import benchmark available. |
| Qwen3 32B | `qwen3:32b` | `prune_failed` | No completed shared-contract benchmark available. | No completed smart import benchmark available. |
| Qwen3.5 35B A3B | `qwen3.5:35b-a3b` | `protected_active` | No completed shared-contract benchmark available. | No completed smart import benchmark available. |
| MedGemma 1.5 4B IT | `hf.co/unsloth/medgemma-1.5-4b-it-GGUF:latest` | `prune_failed` | No completed shared-contract benchmark available. | No completed smart import benchmark available. |
| BioMistral 7B | n/a | `blocked` | No completed shared-contract benchmark available. | No runnable model id available for smart import benchmark. |
| Meditron 7B | n/a | `blocked` | No completed shared-contract benchmark available. | No runnable model id available for smart import benchmark. |
| OpenMed PII Italian ClinicalLongformer | n/a | `lane_pending` | No completed shared-contract benchmark available. | No runnable model id available for smart import benchmark. |
| HUMADEX Italian Medical NER | n/a | `lane_pending` | No completed shared-contract benchmark available. | No runnable model id available for smart import benchmark. |
| bioBIT | n/a | `lane_pending` | No completed shared-contract benchmark available. | No runnable model id available for smart import benchmark. |
| medBIT | n/a | `lane_pending` | No completed shared-contract benchmark available. | No runnable model id available for smart import benchmark. |
| BiomedBERT PubMedBERT | n/a | `lane_pending` | No completed shared-contract benchmark available. | No runnable model id available for smart import benchmark. |
| Bio ClinicalBERT | n/a | `lane_pending` | No completed shared-contract benchmark available. | No runnable model id available for smart import benchmark. |

