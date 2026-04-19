#!/usr/bin/env python3
# @Codex

import json
import os
import re
import sys
import traceback

from transformers import AutoModelForTokenClassification, AutoTokenizer, pipeline
import torch

SCHEMA_VERSION = "mediflow.clinical_entities.v1"
MODEL_NAME = os.environ.get("MEDIFLOW_HUMADEX_MODEL", "HUMADEX/italian_medical_ner")
LOCAL_FILES_ONLY = os.environ.get("MEDIFLOW_HUMADEX_LOCAL_FILES_ONLY", "0") == "1"

ENTITY_TYPE_MAP = {
    "PROBLEM": "problem",
    "TREATMENT": "medication",
}

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
    forced = os.environ.get("MEDIFLOW_HUMADEX_DEVICE", "").strip()
    if forced:
        return forced
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def to_utf16_offset(text, codepoint_offset):
    return len(text[:codepoint_offset].encode("utf-16-le")) // 2


def is_token_char(value):
    return value.isalnum() or value in TOKEN_EXTRA_CHARS


def build_pipeline():
    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_NAME,
        local_files_only=LOCAL_FILES_ONLY,
    )
    model = AutoModelForTokenClassification.from_pretrained(
        MODEL_NAME,
        local_files_only=LOCAL_FILES_ONLY,
    )

    chosen_device = choose_device()

    try:
        ner_pipeline = pipeline(
            "token-classification",
            model=model,
            tokenizer=tokenizer,
            aggregation_strategy="simple",
            device=chosen_device,
        )
        return ner_pipeline, chosen_device
    except Exception:
        if chosen_device == "cpu":
            raise

        ner_pipeline = pipeline(
            "token-classification",
            model=model,
            tokenizer=tokenizer,
            aggregation_strategy="simple",
            device="cpu",
        )
        return ner_pipeline, "cpu"


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


def map_entity(item, threshold):
    label = str(item.get("entity_group") or item.get("entity") or "").upper()
    entity_type = ENTITY_TYPE_MAP.get(label)
    if not entity_type:
        return None

    score = float(item.get("score") or 0.0)
    if score < threshold:
        return None

    start = int(item.get("start", -1))
    end = int(item.get("end", -1))
    if start < 0 or end <= start:
        return None

    return {
        "type": entity_type,
        "start_cp": start,
        "end_cp": end,
        "confidence": round(score, 4),
    }


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


def handle_request(ner_pipeline, request):
    request_id = request.get("id")
    text = request.get("text")
    if not isinstance(text, str) or not text.strip():
        return {
            "id": request_id,
            "error": "Text must be a non-empty string.",
        }

    threshold = float(request.get("confidenceThreshold") or 0.0)
    entities = []
    for item in ner_pipeline(text):
        mapped = map_entity(item, threshold)
        if mapped is not None:
            entities.append(mapped)

    return {
        "id": request_id,
        "schemaVersion": SCHEMA_VERSION,
        "entities": normalize_entities(text, entities),
    }


def main():
    try:
        ner_pipeline, active_device = build_pipeline()
    except Exception as exc:
        emit({
            "type": "startup_error",
            "error": f"Failed to load {MODEL_NAME}: {exc}",
        })
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    emit({
        "type": "ready",
        "model": MODEL_NAME,
        "device": active_device,
        "localFilesOnly": LOCAL_FILES_ONLY,
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

        try:
            emit(handle_request(ner_pipeline, request))
        except Exception as exc:
            emit({
                "id": request.get("id"),
                "error": f"Runner inference error: {exc}",
            })
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()
