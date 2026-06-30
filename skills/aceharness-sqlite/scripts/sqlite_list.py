import sys
from runtime_api import request_json


if __name__ == "__main__":
    sys.exit(request_json("GET", "/api/runtime/sqlite/databases"))
