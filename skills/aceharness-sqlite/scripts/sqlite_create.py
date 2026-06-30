import argparse
import sys
from runtime_api import request_json


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    args = parser.parse_args()
    sys.exit(request_json("POST", "/api/runtime/sqlite/databases", {"name": args.db}))
