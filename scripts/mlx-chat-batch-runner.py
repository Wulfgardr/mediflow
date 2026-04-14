#!/usr/bin/env python3
# @Codex
from __future__ import annotations

import argparse
import json
import os
import platform
import statistics
import sys
from datetime import datetime, UTC
from pathlib import Path
from typing import Any

import mlx.core as mx
from mlx_lm import load
from mlx_lm import __version__ as mlx_lm_version
from mlx_lm.generate import DEFAULT_QUANTIZED_KV_START, stream_generate
from mlx_lm.sample_utils import make_sampler


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CORPUS_PATH = SCRIPT_DIR / "fixtures" / "mlx-runtime-benchmark-corpus.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Benchmark-only MLX runner for isolated runtime comparisons, including "
            "KV cache quantization variants."
        )
    )
    parser.add_argument("--model", required=True, help="Local model path or Hugging Face repo.")
    parser.add_argument("--corpus", default=str(DEFAULT_CORPUS_PATH), help="Path to JSON corpus.")
    parser.add_argument("--out", help="Optional path to write JSON report.")
    parser.add_argument("--system-prompt", default=None, help="Optional system prompt.")
    parser.add_argument(
        "--ignore-chat-template",
        action="store_true",
        help="Use raw prompts even if the tokenizer exposes a chat template.",
    )
    parser.add_argument("--max-tokens", type=int, default=None, help="Override case max tokens.")
    parser.add_argument("--temp", type=float, default=0.0, help="Sampling temperature.")
    parser.add_argument("--top-p", type=float, default=1.0, help="Sampling top-p.")
    parser.add_argument("--min-p", type=float, default=0.0, help="Sampling min-p.")
    parser.add_argument("--top-k", type=int, default=0, help="Sampling top-k.")
    parser.add_argument("--min-tokens-to-keep", type=int, default=1, help="Minimum tokens to keep for min-p.")
    parser.add_argument("--seed", type=int, default=7, help="Deterministic seed base.")
    parser.add_argument("--max-kv-size", type=int, default=None, help="Optional max KV cache size.")
    parser.add_argument("--quantize-activations", action="store_true", help="Pass quantize activations to model load.")
    parser.add_argument("--kv-bits", type=int, default=None, help="Run a single quantized variant with the given KV bits.")
    parser.add_argument("--kv-group-size", type=int, default=64, help="KV cache quantization group size.")
    parser.add_argument(
        "--quantized-kv-start",
        type=int,
        default=DEFAULT_QUANTIZED_KV_START,
        help="Step at which KV cache quantization starts.",
    )
    parser.add_argument(
        "--compare-kv-bits",
        type=int,
        default=None,
        help="Run baseline plus a quantized comparison variant with the given KV bits.",
    )
    parser.add_argument("--case", action="append", dest="case_ids", help="Case id filter; repeatable.")
    parser.add_argument("--limit", type=int, default=None, help="Optional case limit after filtering.")
    parser.add_argument("--include-output", action="store_true", help="Persist full outputs in the report.")
    parser.add_argument("--dry-run", action="store_true", help="Resolve config and corpus only, without loading the model.")
    return parser.parse_args()


def load_corpus(path: Path, case_ids: set[str] | None, limit: int | None) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text("utf8"))
    if not isinstance(payload, list):
        raise ValueError("Corpus must be a JSON array.")

    cases: list[dict[str, Any]] = []
    for raw_case in payload:
        if not isinstance(raw_case, dict):
            raise ValueError("Corpus entries must be JSON objects.")
        case_id = str(raw_case.get("id", "")).strip()
        prompt = str(raw_case.get("prompt", "")).strip()
        if not case_id or not prompt:
            raise ValueError("Every corpus entry must include non-empty 'id' and 'prompt'.")
        if case_ids and case_id not in case_ids:
            continue
        max_tokens = raw_case.get("maxTokens")
        cases.append(
            {
                "id": case_id,
                "prompt": prompt,
                "maxTokens": int(max_tokens) if max_tokens is not None else None,
            }
        )

    if limit is not None:
        cases = cases[:limit]

    if not cases:
        raise ValueError("No corpus cases selected.")

    return cases


def normalize_chat_prompt(tokenizer: Any, prompt: str, system_prompt: str | None, ignore_chat_template: bool) -> str:
    if ignore_chat_template or not getattr(tokenizer, "has_chat_template", False):
        return prompt

    messages: list[dict[str, str]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    return tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int((len(ordered) * fraction) + 0.999999) - 1))
    return round(ordered[index], 4)


def summarize_variant(results: list[dict[str, Any]]) -> dict[str, Any]:
    successful = [case for case in results if not case.get("error")]
    wall_times = [float(case["wallTimeSec"]) for case in successful]
    prompt_tps = [float(case["promptTokensPerSec"]) for case in successful]
    generation_tps = [float(case["generationTokensPerSec"]) for case in successful]
    peak_memory = [float(case["peakMemoryGb"]) for case in successful]

    return {
        "caseCount": len(results),
        "successfulCases": len(successful),
        "failedCases": len(results) - len(successful),
        "avgWallTimeSec": round(statistics.fmean(wall_times), 4) if wall_times else 0.0,
        "p95WallTimeSec": percentile(wall_times, 0.95),
        "avgPromptTokensPerSec": round(statistics.fmean(prompt_tps), 4) if prompt_tps else 0.0,
        "avgGenerationTokensPerSec": round(statistics.fmean(generation_tps), 4) if generation_tps else 0.0,
        "avgPeakMemoryGb": round(statistics.fmean(peak_memory), 4) if peak_memory else 0.0,
        "maxPeakMemoryGb": round(max(peak_memory), 4) if peak_memory else 0.0,
    }


def build_sampler(tokenizer: Any, args: argparse.Namespace):
    return make_sampler(
        args.temp,
        args.top_p,
        args.min_p,
        args.min_tokens_to_keep,
        top_k=args.top_k,
        xtc_probability=0.0,
        xtc_threshold=0.0,
        xtc_special_tokens=tokenizer.encode("\n") + list(tokenizer.eos_token_ids),
    )


def build_variants(args: argparse.Namespace) -> tuple[list[dict[str, Any]], dict[str, str]]:
    historical_envs = {
        "MEDIFLOW_MLX_TURBOQUANT": os.getenv("MEDIFLOW_MLX_TURBOQUANT"),
        "MEDIFLOW_MLX_TURBOQUANT_BITS": os.getenv("MEDIFLOW_MLX_TURBOQUANT_BITS"),
        "MEDIFLOW_MLX_TURBOQUANT_GROUP_SIZE": os.getenv("MEDIFLOW_MLX_TURBOQUANT_GROUP_SIZE"),
        "MEDIFLOW_MLX_TURBOQUANT_START": os.getenv("MEDIFLOW_MLX_TURBOQUANT_START"),
        "MEDIFLOW_MLX_TURBOQUANT_QJL_FEATURES": os.getenv("MEDIFLOW_MLX_TURBOQUANT_QJL_FEATURES"),
        "MEDIFLOW_MLX_TURBOQUANT_FP16_SINK_SIZE": os.getenv("MEDIFLOW_MLX_TURBOQUANT_FP16_SINK_SIZE"),
    }

    if args.compare_kv_bits is not None and args.kv_bits is not None:
        raise ValueError("Use either --kv-bits or --compare-kv-bits, not both.")

    if args.compare_kv_bits is not None:
        return (
            [
                {
                    "id": "baseline",
                    "label": "baseline",
                    "kvBits": None,
                    "kvGroupSize": args.kv_group_size,
                    "quantizedKvStart": args.quantized_kv_start,
                },
                {
                    "id": f"kv_bits_{args.compare_kv_bits}",
                    "label": f"kv_bits_{args.compare_kv_bits}",
                    "kvBits": args.compare_kv_bits,
                    "kvGroupSize": args.kv_group_size,
                    "quantizedKvStart": args.quantized_kv_start,
                },
            ],
            historical_envs,
        )

    env_enabled = str(historical_envs["MEDIFLOW_MLX_TURBOQUANT"] or "").strip().lower() in {"1", "true", "yes", "on"}
    env_bits = historical_envs["MEDIFLOW_MLX_TURBOQUANT_BITS"]
    env_group_size = historical_envs["MEDIFLOW_MLX_TURBOQUANT_GROUP_SIZE"]
    env_start = historical_envs["MEDIFLOW_MLX_TURBOQUANT_START"]

    kv_bits = args.kv_bits
    if kv_bits is None and (env_enabled or env_bits):
        kv_bits = int(env_bits or 3)

    kv_group_size = args.kv_group_size if args.kv_group_size is not None else int(env_group_size or 64)
    quantized_kv_start = args.quantized_kv_start if args.quantized_kv_start is not None else int(env_start or DEFAULT_QUANTIZED_KV_START)
    label = "baseline" if kv_bits is None else f"kv_bits_{kv_bits}"

    return (
        [
            {
                "id": label,
                "label": label,
                "kvBits": kv_bits,
                "kvGroupSize": kv_group_size,
                "quantizedKvStart": quantized_kv_start,
            }
        ],
        historical_envs,
    )


def run_variant(
    model: Any,
    tokenizer: Any,
    sampler: Any,
    variant: dict[str, Any],
    cases: list[dict[str, Any]],
    args: argparse.Namespace,
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for case_index, case in enumerate(cases):
        prompt = normalize_chat_prompt(
            tokenizer=tokenizer,
            prompt=case["prompt"],
            system_prompt=args.system_prompt,
            ignore_chat_template=args.ignore_chat_template,
        )
        case_max_tokens = args.max_tokens or case.get("maxTokens") or 96
        if args.seed is not None:
            mx.random.seed(args.seed + case_index)
        mx.reset_peak_memory()

        case_result: dict[str, Any] = {
            "id": case["id"],
            "maxTokens": case_max_tokens,
            "promptChars": len(case["prompt"]),
            "renderedPromptChars": len(prompt),
        }

        try:
            started_at = mx.array([0])  # keeps mypy quiet on initialized locals pattern
            del started_at
            wall_start = datetime.now(UTC)
            monotonic_start = mx.array([0])
            del monotonic_start

            import time

            started = time.perf_counter()
            final_response = None
            output_chunks: list[str] = []
            for response in stream_generate(
                model,
                tokenizer,
                prompt,
                max_tokens=case_max_tokens,
                sampler=sampler,
                max_kv_size=args.max_kv_size,
                kv_bits=variant["kvBits"],
                kv_group_size=variant["kvGroupSize"],
                quantized_kv_start=variant["quantizedKvStart"],
            ):
                final_response = response
                output_chunks.append(response.text)

            wall_time = round(time.perf_counter() - started, 4)
            if final_response is None:
                raise RuntimeError("No generation response produced.")

            output_text = "".join(output_chunks)
            case_result.update(
                {
                    "generatedAt": wall_start.isoformat(),
                    "wallTimeSec": wall_time,
                    "promptTokens": int(final_response.prompt_tokens),
                    "generationTokens": int(final_response.generation_tokens),
                    "promptTokensPerSec": round(float(final_response.prompt_tps), 4),
                    "generationTokensPerSec": round(float(final_response.generation_tps), 4),
                    "peakMemoryGb": round(float(final_response.peak_memory), 4),
                    "finishReason": final_response.finish_reason,
                    "outputPreview": output_text[:200],
                }
            )
            if args.include_output:
                case_result["outputText"] = output_text
        except Exception as error:  # pragma: no cover - runtime safety path
            case_result["error"] = str(error)

        results.append(case_result)

    variant_report = {
        **variant,
        "cases": results,
        "summary": summarize_variant(results),
    }
    return variant_report


def main() -> int:
    args = parse_args()
    corpus_path = Path(args.corpus).resolve()
    case_ids = set(args.case_ids or [])
    cases = load_corpus(corpus_path, case_ids if case_ids else None, args.limit)
    variants, historical_envs = build_variants(args)

    report: dict[str, Any] = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "model": args.model,
        "corpusPath": str(corpus_path),
        "caseIds": [case["id"] for case in cases],
        "runtime": {
            "python": platform.python_version(),
            "mlxLmVersion": mlx_lm_version,
            "platform": platform.platform(),
        },
        "historicalTurboQuantEnv": historical_envs,
        "variants": variants if args.dry_run else [],
    }

    unsupported_envs = {
        key: value
        for key, value in historical_envs.items()
        if key in {"MEDIFLOW_MLX_TURBOQUANT_QJL_FEATURES", "MEDIFLOW_MLX_TURBOQUANT_FP16_SINK_SIZE"} and value
    }
    if unsupported_envs:
        report["notes"] = [
            "Current mlx_lm runtime exposes KV cache quantization knobs but not the older local shim controls for QJL features or FP16 sink size.",
        ]
        report["unsupportedHistoricalTurboQuantEnv"] = unsupported_envs

    if args.dry_run:
        output = json.dumps(report, indent=2)
        if args.out:
            Path(args.out).resolve().write_text(output, "utf8")
        print(output)
        return 0

    model, tokenizer = load(
        args.model,
        model_config={"quantize_activations": args.quantize_activations},
    )
    sampler = build_sampler(tokenizer, args)

    variant_reports = [
        run_variant(model, tokenizer, sampler, variant, cases, args)
        for variant in variants
    ]
    report["variants"] = variant_reports

    if len(variant_reports) == 2:
        baseline = variant_reports[0]["summary"]
        candidate = variant_reports[1]["summary"]
        report["comparison"] = {
            "baselineVariant": variant_reports[0]["id"],
            "candidateVariant": variant_reports[1]["id"],
            "deltaAvgWallTimeSec": round(candidate["avgWallTimeSec"] - baseline["avgWallTimeSec"], 4),
            "deltaAvgPeakMemoryGb": round(candidate["avgPeakMemoryGb"] - baseline["avgPeakMemoryGb"], 4),
            "deltaAvgGenerationTokensPerSec": round(candidate["avgGenerationTokensPerSec"] - baseline["avgGenerationTokensPerSec"], 4),
            "deltaAvgPromptTokensPerSec": round(candidate["avgPromptTokensPerSec"] - baseline["avgPromptTokensPerSec"], 4),
        }

    output = json.dumps(report, indent=2)
    if args.out:
        Path(args.out).resolve().write_text(output, "utf8")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
