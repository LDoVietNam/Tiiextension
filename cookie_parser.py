import json
import json
import sys

def parse_and_print_cookies(json_input):
    """
    Parse JSON cookie data and print name and value of each cookie.
    
    Args:
        json_input: JSON string or file path containing cookie data
    """
    try:
        # Try to parse as JSON string first
        try:
            cookies = json.loads(json_input)
        except json.JSONDecodeError:
            # If that fails, treat as file path
            with open(json_input, 'r', encoding='utf-8') as f:
                cookies = json.load(f)
        
        # Handle both single cookie object and array of cookies
        if isinstance(cookies, dict):
            cookies = [cookies]
        elif not isinstance(cookies, list):
            print("Error: JSON must be a cookie object or array of cookie objects")
            return
        
        print("Cookie Name\t\tCookie Value")
        print("-" * 50)
        for cookie in cookies:
            if isinstance(cookie, dict) and 'name' in cookie and 'value' in cookie:
                # Decode URL-encoded values if needed
                name = cookie['name']
                value = cookie['value']
                print(f"{name}\t\t{value}")
            else:
                print(f"Invalid cookie format: {cookie}")
                
    except FileNotFoundError:
        print(f"Error: File '{json_input}' not found.")
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON format - {e}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Use command line argument as input
        parse_and_print_cookies(sys.argv[1])
    else:
        # Read from stdin
        print("Enter cookie JSON (Ctrl+D to finish):")
        try:
            data = sys.stdin.read()
            parse_and_print_cookies(data)
        except KeyboardInterrupt:
            print("\nInput cancelled.")