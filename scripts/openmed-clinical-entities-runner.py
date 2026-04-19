#!/usr/bin/env python3
# @Codex

import json
import os
import re
import sys
import traceback

from openmed import analyze_text
from openmed.core.models import ModelLoader
import torch

SCHEMA_VERSION = "mediflow.clinical_entities.v1"
DEFAULT_DISEASE_MODEL = os.environ.get(
    "MEDIFLOW_OPENMED_DISEASE_MODEL",
    "disease_detection_superclinical",
)
DEFAULT_PHARMA_MODEL = os.environ.get(
    "MEDIFLOW_OPENMED_PHARMA_MODEL",
    "pharma_detection_superclinical",
)
CONFIDENCE_THRESHOLD = float(os.environ.get("MEDIFLOW_OPENMED_CONFIDENCE_THRESHOLD", "0.0"))

PROBLEM_LABELS = {"DISEASE", "CONDITION", "PATHOLOGY", "DIAGNOSIS"}
MEDICATION_LABELS = {"CHEM", "DRUG", "MEDICATION", "TREATMENT"}
TOKEN_EXTRA_CHARS = {"/", "-", ",", "+", "%"}
PROBLEM_MERGE_GAP_RE = re.compile(r"^[\s/,\-]+$")
MEDICATION_MERGE_GAP_RE = re.compile(r"^[\s/,\-]*[/,\-][\s/,\-]*$")
MEDICATION_DOSAGE_RE = re.compile(
    r"^\s+\d+(?:[.,]\d+)?(?:/\d+(?:[.,]\d+)?)?\s*(?:mg|mcg|g|ml|ui|µg|ug)\b",
    re.IGNORECASE,
)


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def choose_device():
    forced = os.environ.get("MEDIFLOW_OPENMED_DEVICE", "").strip()
    if forced:
        return forced
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def to_utf16_offset(text, codepoint_offset):
    return len(text[:codepoint_offset].encode("utf-16-le")) // 2


def is_token_char(value):
    return value.isalnum() or value in TOKEN_EXTRA_CHARS


def label_to_type(label):
    upper = str(label or "").upper()
    if upper in PROBLEM_LABELS:
        return "problem"
    if upper in MEDICATION_LABELS:
        return "medication"
    return None


def expand_to_token_boundaries(text, start, end):
    while start > 0 and is_token_char(text[start - 1]):
        start -= 1
    while end < len(text) and is_token_char(text[end]):
        end += 1
    return start, end


def maybe_extend_medication_span(text, start, end):
    suffix = text[end:]
    match = MEDICATION_DOSAGE_RE.match(suffix)
    if match:
        end += len(match.group(0))
    return start, end


def normalize_entities(text, entities):
    normalized = []

    for entity in entities:
        start, end = expand_to_token_boundaries(text, entity["start_cp"], entity["end_cp"])
        if entity["type"] == "medication":
            start, end = maybe_extend_medication_span(text, start, end)
        normalized.append({
            "type": entity["type"],
            "start_cp": start,
            "end_cp": end,
            "confidence": entity["confidence"],
        })

    normalized.sort(key=lambda item: (item["type"], item["start_cp"], item["end_cp"]))

    merged = []
    for entity in normalized:
        if not merged:
            merged.append(entity)
            continue

        last = merged[-1]
        gap = text[last["end_cp"]:entity["start_cp"]]
        overlaps = entity["start_cp"] <= last["end_cp"]
        mergeable_gap = (
            bool(PROBLEM_MERGE_GAP_RE.match(gap))
            if entity["type"] == "problem"
            else bool(MEDICATION_MERGE_GAP_RE.match(gap))
        )

        if entity["type"] == last["type"] and (overlaps or mergeable_gap):
            last["end_cp"] = max(last["end_cp"], entity["end_cp"])
            last["confidence"] = max(last["confidence"], entity["confidence"])
            continue

        merged.append(entity)

    unique = []
    seen = set()
    for entity in merged:
        key = (entity["type"], entity["start_cp"], entity["end_cp"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(entity)

    return [
        {
            "type": entity["type"],
            "text": text[entity["start_cp"]:entity["end_cp"]],
            "evidence": text[entity["start_cp"]:entity["end_cp"]],
            "start": to_utf16_offset(text, entity["start_cp"]),
            "end": to_utf16_offset(text, entity["end_cp"]),
            "confidence": entity["confidence"],
        }
        for entity in unique
        if entity["end_cp"] > entity["start_cp"]
    ]


def to_raw_entities(result):
    entities = []
    for prediction in getattr(result, "entities", []):
        entity_type = label_to_type(getattr(prediction, "label", ""))
        if not entity_type:
            continue

        start = int(getattr(prediction, "start", -1))
        end = int(getattr(prediction, "end", -1))
        if start < 0 or end <= start:
            continue

        entities.append({
            "type": entity_type,
            "start_cp": start,
            "end_cp": end,
            "confidence": float(getattr(prediction, "confidence", 0.0)),
        })
    return entities


def build_loader():
    device = choose_device()
    pipeline_device = 0 if device in {"mps", "cuda"} else -1
    loader = ModelLoader()
    return loader, device, pipeline_device


def analyze_with_model(text, model_name, loader, pipeline_device):
    result = analyze_text(
        text,
        model_name=model_name,
        loader=loader,
        output_format="dict",
        group_entities=True,
        sentence_language="it",
        confidence_threshold=CONFIDENCE_THRESHOLD,
        aggregation_strategy="simple",
        device=pipeline_device,
    )
    return to_raw_entities(result)


def handle_request(text, loader, pipeline_device):
    entities = []
    entities.extend(analyze_with_model(text, DEFAULT_DISEASE_MODEL, loader, pipeline_device))
    entities.extend(analyze_with_model(text, DEFAULT_PHARMA_MODEL, loader, pipeline_device))
    return normalize_entities(text, entities)


def main():
    try:
        loader, device, pipeline_device = build_loader()
    except Exception as exc:
        emit({
            "type": "startup_error",
            "error": f"Failed to initialize OpenMed loader: {exc}",
        })
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    emit({
        "type": "ready",
        "device": device,
        "pipelineDevice": pipeline_device,
        "diseaseModel": DEFAULT_DISEASE_MODEL,
        "pharmaModel": DEFAULT_PHARMA_MODEL,
        "confidenceThreshold": CONFIDENCE_THRESHOLD,
    })

    for line in sys.stdin:
        payload = line.strip()
        if not payload:
            continue

        try:
            request = json.loads(payload)
        except Exception as exc:
            emit({
                "id": None,
                "error": f"Invalid JSON request: {exc}",
            })
            continue

        request_id = request.get("id")
        text = request.get("text")
        if not isinstance(text, str) or not text.strip():
            emit({
                "id": request_id,
                "error": "Text must be a non-empty string.",
            })
            continue

        try:
            emit({
                "id": request_id,
                "schemaVersion": SCHEMA_VERSION,
                "entities": handle_request(text, loader, pipeline_device),
            })
        except Exception as exc:
            emit({
                "id": request_id,
                "error": f"OpenMed inference error: {exc}",
            })
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()
