import argparse
import json
import sys
from runtime_api import request_json


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--file", required=True)
    args = parser.parse_args()
    try:
        with open(args.file, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception as exc:
        print("failed to read transaction file: %s" % exc, file=sys.stderr)
        sys.exit(2)
    statements = data.get("statements") if isinstance(data, dict) else data
    sys.exit(request_json("POST", "/api/runtime/sqlite/transaction", {
        "database": args.db,
        "statements": statements,
    }))
