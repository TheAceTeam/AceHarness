import argparse
import sys
from runtime_api import encode_path, request_json


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    args = parser.parse_args()
    sys.exit(request_json("DELETE", "/api/runtime/sqlite/databases/" + encode_path(args.db)))
