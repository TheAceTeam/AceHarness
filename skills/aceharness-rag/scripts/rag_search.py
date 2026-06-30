import argparse
import sys
from runtime_api import request_json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--kb", required=True, dest="knowledge_base_id")
    parser.add_argument("--query", required=True)
    parser.add_argument("--top-k", type=int, default=None)
    args = parser.parse_args()
    payload = {
        "knowledgeBaseId": args.knowledge_base_id,
        "query": args.query,
    }
    if args.top_k is not None:
        payload["topK"] = args.top_k
    return request_json("POST", "/api/runtime/rag/search", payload)


if __name__ == "__main__":
    sys.exit(main())
