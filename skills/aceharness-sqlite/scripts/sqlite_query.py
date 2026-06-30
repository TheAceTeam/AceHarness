import argparse
import sys
from runtime_api import parse_json_arg, request_json


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--sql", required=True)
    parser.add_argument("--params", default=None)
    parser.add_argument("--limit", type=int, default=200)
    args = parser.parse_args()
    sys.exit(request_json("POST", "/api/runtime/sqlite/query", {
        "database": args.db,
        "sql": args.sql,
        "params": parse_json_arg(args.params, []),
        "limit": args.limit,
    }))
