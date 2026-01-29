"""Gmail API client for the worker."""

import base64
import re
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from config import get_settings
from encryption import decrypt, encrypt

settings = get_settings()


def get_gmail_service(access_token: str, refresh_token: str):
    """Create a Gmail API service instance."""
    credentials = Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
    )
    return build('gmail', 'v1', credentials=credentials)


def get_gmail_service_from_encrypted(access_token_enc: str, refresh_token_enc: str):
    """Create Gmail service from encrypted tokens."""
    access_token = decrypt(access_token_enc)
    refresh_token = decrypt(refresh_token_enc)
    return get_gmail_service(access_token, refresh_token)


def fetch_message_ids_for_backfill(
    service,
    after_date: datetime,
    exclude_labels: Optional[List[str]] = None,
    max_results: int = 500
) -> List[str]:
    """Fetch message IDs for backfill within a date range."""
    message_ids = []
    page_token = None
    
    # Build query
    query_parts = [f"after:{int(after_date.timestamp())}"]
    if exclude_labels:
        for label in exclude_labels:
            query_parts.append(f"-label:{label}")
    
    query = " ".join(query_parts)
    
    while True:
        try:
            response = service.users().messages().list(
                userId='me',
                q=query,
                maxResults=min(max_results - len(message_ids), 500),
                pageToken=page_token
            ).execute()
            
            if 'messages' in response:
                message_ids.extend([msg['id'] for msg in response['messages']])
            
            page_token = response.get('nextPageToken')
            if not page_token or len(message_ids) >= max_results:
                break
                
        except HttpError as e:
            raise Exception(f"Failed to list messages: {e}")
    
    return message_ids


def fetch_history_changes(
    service,
    start_history_id: str
) -> Dict[str, Any]:
    """Fetch changes since a history ID."""
    message_ids = set()
    new_history_id = None
    page_token = None
    
    try:
        while True:
            response = service.users().history().list(
                userId='me',
                startHistoryId=start_history_id,
                historyTypes=['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
                pageToken=page_token
            ).execute()
            
            new_history_id = response.get('historyId')
            
            if 'history' in response:
                for record in response['history']:
                    if 'messagesAdded' in record:
                        for added in record['messagesAdded']:
                            if 'message' in added and 'id' in added['message']:
                                message_ids.add(added['message']['id'])
                    if 'labelsAdded' in record:
                        for labeled in record['labelsAdded']:
                            if 'message' in labeled and 'id' in labeled['message']:
                                message_ids.add(labeled['message']['id'])
                    if 'labelsRemoved' in record:
                        for unlabeled in record['labelsRemoved']:
                            if 'message' in unlabeled and 'id' in unlabeled['message']:
                                message_ids.add(unlabeled['message']['id'])
            
            page_token = response.get('nextPageToken')
            if not page_token:
                break
                
    except HttpError as e:
        if e.resp.status == 404:
            # History ID too old, need full sync
            return {"message_ids": [], "new_history_id": None}
        raise Exception(f"Failed to fetch history: {e}")
    
    return {
        "message_ids": list(message_ids),
        "new_history_id": new_history_id
    }


def fetch_message(service, message_id: str) -> Optional[Dict[str, Any]]:
    """Fetch a single message with full payload."""
    try:
        return service.users().messages().get(
            userId='me',
            id=message_id,
            format='full'
        ).execute()
    except HttpError as e:
        if e.resp.status == 404:
            return None
        raise Exception(f"Failed to fetch message {message_id}: {e}")


def parse_message(message: Dict[str, Any]) -> Dict[str, Any]:
    """Parse a Gmail message into a structured format."""
    headers = message.get('payload', {}).get('headers', [])
    
    def get_header(name: str) -> Optional[str]:
        for h in headers:
            if h.get('name', '').lower() == name.lower():
                return h.get('value')
        return None
    
    def parse_address(value: Optional[str]) -> Dict[str, Optional[str]]:
        if not value:
            return {"email": "", "name": None}
        match = re.match(r'^(?:"?([^"]*)"?\s)?<?([^>]+@[^>]+)>?$', value)
        if match:
            return {"email": match.group(2), "name": match.group(1)}
        return {"email": value, "name": None}
    
    def parse_address_list(value: Optional[str]) -> List[str]:
        if not value:
            return []
        return [parse_address(addr.strip())["email"] for addr in value.split(",") if addr.strip()]
    
    from_parsed = parse_address(get_header("From"))
    date_str = get_header("Date")
    
    # Parse date
    date = None
    if date_str:
        try:
            from email.utils import parsedate_to_datetime
            date = parsedate_to_datetime(date_str)
        except:
            date = datetime.fromtimestamp(int(message.get('internalDate', 0)) / 1000)
    else:
        date = datetime.fromtimestamp(int(message.get('internalDate', 0)) / 1000)
    
    # Extract body
    body_text, body_html = extract_body(message.get('payload', {}))
    
    # Extract attachments
    attachments = extract_attachments(message.get('payload', {}))
    
    return {
        "gmail_message_id": message['id'],
        "gmail_thread_id": message['threadId'],
        "from_address": from_parsed["email"],
        "from_name": from_parsed["name"],
        "to_addresses": parse_address_list(get_header("To")),
        "cc_addresses": parse_address_list(get_header("Cc")),
        "bcc_addresses": parse_address_list(get_header("Bcc")),
        "date": date,
        "subject": get_header("Subject"),
        "snippet": message.get('snippet'),
        "body_text": body_text,
        "body_html": body_html,
        "labels": message.get('labelIds', []),
        "has_attachments": len(attachments) > 0,
        "attachments": attachments,
    }


def extract_body(payload: Dict[str, Any]) -> tuple[Optional[str], Optional[str]]:
    """Extract text and HTML body from message payload."""
    body_text = None
    body_html = None
    
    def process_part(part: Dict[str, Any]):
        nonlocal body_text, body_html
        
        mime_type = part.get('mimeType', '')
        body_data = part.get('body', {}).get('data')
        
        if body_data:
            decoded = base64.urlsafe_b64decode(body_data).decode('utf-8', errors='replace')
            if mime_type == 'text/plain':
                body_text = decoded
            elif mime_type == 'text/html':
                body_html = decoded
        
        for sub_part in part.get('parts', []):
            process_part(sub_part)
    
    process_part(payload)
    
    # If no plain text, extract from HTML
    if not body_text and body_html:
        body_text = html_to_text(body_html)
    
    return body_text, body_html


def extract_attachments(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract attachment metadata from message payload."""
    attachments = []
    
    def process_part(part: Dict[str, Any]):
        filename = part.get('filename')
        body = part.get('body', {})
        
        if filename and body.get('attachmentId'):
            attachments.append({
                "filename": filename,
                "mime_type": part.get('mimeType', 'application/octet-stream'),
                "size": body.get('size', 0),
                "attachment_id": body['attachmentId'],
            })
        
        for sub_part in part.get('parts', []):
            process_part(sub_part)
    
    process_part(payload)
    return attachments


def html_to_text(html: str) -> str:
    """Convert HTML to plain text."""
    import re
    
    # Remove scripts and styles
    text = re.sub(r'<script[^>]*>[\s\S]*?</script>', '', html, flags=re.IGNORECASE)
    text = re.sub(r'<style[^>]*>[\s\S]*?</style>', '', text, flags=re.IGNORECASE)
    
    # Replace common tags
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</p>', '\n\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</div>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</li>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</tr>', '\n', text, flags=re.IGNORECASE)
    
    # Remove remaining tags
    text = re.sub(r'<[^>]+>', '', text)
    
    # Decode entities
    text = text.replace('&nbsp;', ' ')
    text = text.replace('&amp;', '&')
    text = text.replace('&lt;', '<')
    text = text.replace('&gt;', '>')
    text = text.replace('&quot;', '"')
    text = text.replace('&#39;', "'")
    
    # Clean up whitespace
    text = re.sub(r'\n\s*\n\s*\n', '\n\n', text)
    
    return text.strip()


def get_gmail_profile(service) -> Dict[str, str]:
    """Get Gmail profile including history ID."""
    response = service.users().getProfile(userId='me').execute()
    return {
        "email": response['emailAddress'],
        "history_id": response['historyId'],
    }
