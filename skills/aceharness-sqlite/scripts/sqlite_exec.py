import argparse
import sys
from runtime_api import parse_json_arg, request_json


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--sql", required=True)
    parser.add_argument("--params", default=None)
    args = parser.parse_args()
    sys.exit(request_json("POST", "/api/runtime/sqlite/exec", {
        "database": args.db,
        "sql": args.sql,
        "params": parse_json_arg(args.params, []),
    }))
