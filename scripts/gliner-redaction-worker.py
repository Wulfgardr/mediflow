# @Codex — local inference only. The host supplies an already installed model.
import contextlib
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys

REVISION = "c153999da5f4c509df4322b0c6a1baf3d2c284d7"
FILES = {
    "model.safetensors": "0280f6f39f6012da50b6640bad438d9b7e763a1b0102094115d1b710c4dd79b6",
    "config.json": "164f17362bcf9d114067d3465e7374bfdd79ce6b605acb745de5a49dabb9595c",
    "encoder_config/config.json": "f27dd63cc43a248d2566f0b6ad7a115db353676ce0561dcbca45bac766464c1a",
    "tokenizer.json": "f6df10ec83bea993035b2dd7c39345a3d4fcf23421c2adb6cb4ffc1e6d1bc4b5",
    # Compatibility copy: V5 extra_special_tokens -> V4 additional_special_tokens.
    "tokenizer_config.json": "8c916ee43ae43bf5945499f0405cac73da2b31f3ba04cf8c74a41cbd152b6330",
}
VERSIONS = {"gliner2": "2.0.0", "torch": "2.14.0", "transformers": "4.57.6", "huggingface-hub": "0.36.2"}
LABELS = ["person", "full_name", "date_of_birth", "email", "phone_number", "address", "street_address", "city", "state_or_region", "postal_code", "government_id", "national_id_number", "tax_id", "sensitive_account_id", "sensitive_date", "document_date"]


def digest_file(file):
    with Path(file).open("rb") as handle:
        before = os.fstat(handle.fileno())
        digest = hashlib.sha256()
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
        after = os.fstat(handle.fileno())
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError("artifact_changed")
    return digest.hexdigest()


def emit(value):
    print(json.dumps(value, ensure_ascii=True, allow_nan=False), flush=True)


def main():
    if len(sys.argv) != 2 or not Path(sys.argv[1]).is_absolute():
        raise ValueError("model_path")
    root = Path(sys.argv[1])
    for name, expected in FILES.items():
        with (root / name).open("rb") as handle:
            digest = hashlib.sha256()
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
            if digest.hexdigest() != expected:
                raise ValueError("artifact")
    for package, version in VERSIONS.items():
        if importlib.metadata.version(package) != version:
            raise ValueError("dependency")
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1", HF_HUB_DISABLE_TELEMETRY="1", TOKENIZERS_PARALLELISM="false")
    # Library diagnostics may contain source text; discard, never persist.
    with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        import torch
        from gliner2 import GLiNER2
        torch.set_num_threads(4)
        model = GLiNER2.from_pretrained(str(root), map_location="cpu", local_files_only=True)
        model.eval()
    # Recheck after load: the observed identity describes the model used by this
    # exact process, not a report supplied by its caller. No input is logged.
    for name, expected in FILES.items():
        if digest_file(root / name) != expected:
            raise ValueError("artifact_changed")
    identity = {"schema": "mediflow.redaction-runtime-binding.v1",
                "adapter": "mediflow.layer1-gliner.runtime.v1", "model": "gliner2-pii",
                "revision": REVISION, "workerSha256": digest_file(__file__),
                "pythonSha256": digest_file(sys.executable), "files": FILES, "packages": VERSIONS}
    emit({"ready": REVISION, "runtimeIdentity": identity})
    while True:
        line = sys.stdin.buffer.readline(100_001)
        if not line:
            return
        if len(line) > 100_000 or not line.endswith(b"\n"):
            raise ValueError("request_size")
        request = json.loads(line)
        if set(request) != {"id", "text"} or type(request["id"]) is not int or request["id"] < 1:
            raise ValueError("request")
        text = request["text"]
        if not isinstance(text, str) or not text or len(text.encode("utf-16-le")) // 2 > 12_000:
            raise ValueError("text")
        with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink), torch.inference_mode():
            result = model.extract_entities(text, LABELS, threshold=0.5, include_confidence=True, include_spans=True)
        emit({"id": request["id"], "entities": result["entities"]})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # No exception message, traceback, path or input on either stream.
        emit({"error": "redaction_worker_failed"})
        sys.exit(1)
