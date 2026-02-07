"""LLM service for email processing."""

import re
import json
from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.language_models import BaseChatModel

from encryption import decrypt
from error_handling import classify_llm_error, LLMError


class ClassificationResult(BaseModel):
    """Result of email classification."""
    category: str = Field(description="Email category: hiring, bills, school, receipts, newsletters, social, shipping, finance, misc")
    priority: str = Field(description="Priority: LOW, NORMAL, HIGH, URGENT")
    needs_reply: bool = Field(description="Whether this email needs a reply")
    spam_score: float = Field(description="Spam likelihood 0-1")
    sensitive_flags: List[str] = Field(description="Detected sensitive content types")
    confidence: float = Field(description="Classification confidence 0-1")


class SummaryResult(BaseModel):
    """Result of thread summarization."""
    short_summary: str = Field(description="1-2 sentence summary")
    full_summary: str = Field(description="2-4 sentence detailed summary")
    what_changed: Optional[str] = Field(description="What changed since last summary", default=None)


class ExtractionResult(BaseModel):
    """Extracted entities and tasks from email."""
    tasks: List[Dict[str, Any]] = Field(description="Extracted action items")
    deadlines: List[Dict[str, str]] = Field(description="Extracted deadlines")
    entities: Dict[str, List[str]] = Field(description="Extracted entities by type")
    key_facts: List[str] = Field(description="Important facts worth remembering")


MODEL_MAP = {
    "gemini-2.5-flash": "gemini-2.0-flash",  # Using stable model
    "gemini-2.5-pro": "gemini-1.5-pro",  # Using stable model
    "gemini-2.0-flash": "gemini-2.0-flash",
    "openai-gpt-4o": "gpt-4o",
    "openai-gpt-4": "gpt-4",
    "openai-gpt-4-turbo": "gpt-4-turbo-preview",
    "openai-gpt-3.5-turbo": "gpt-3.5-turbo",
    "openai-gpt-5.2": "gpt-4o",  # Fallback to gpt-4o
    "anthropic-claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
    "anthropic-claude-3-opus": "claude-3-opus-20240229",
    "anthropic-claude-3-haiku": "claude-3-haiku-20240307",
}


def get_llm(
    api_key_enc: str, 
    provider: str = "gemini-2.5-flash",
    base_url: Optional[str] = None,
    model: Optional[str] = None
) -> BaseChatModel:
    """Get an LLM instance based on provider."""
    api_key = decrypt(api_key_enc)
    
    llm_instance = None
    
    if provider.startswith("gemini-"):
        model_name = MODEL_MAP.get(provider, MODEL_MAP["gemini-2.5-flash"])
        llm_instance = ChatGoogleGenerativeAI(
            model=model_name,
            google_api_key=api_key,
            temperature=0.2,
            max_tokens=4096,
        )
    elif provider.startswith("openai-"):
        model_name = MODEL_MAP.get(provider, "gpt-3.5-turbo")
        # Newer models (GPT-4o, GPT-5.2) use max_completion_tokens instead of max_tokens
        is_new_model = "gpt-4o" in model_name or "gpt-5" in model_name or "o1" in model_name
        
        llm_kwargs = {
            "model": model_name,
            "api_key": api_key,
            "temperature": 0.2,
        }
        
        if is_new_model:
            llm_kwargs["max_completion_tokens"] = 4096
        else:
            llm_kwargs["max_tokens"] = 4096
        
        llm_instance = ChatOpenAI(**llm_kwargs)
    elif provider.startswith("anthropic-"):
        model_name = MODEL_MAP.get(provider, "claude-3-haiku-20240307")
        llm_instance = ChatAnthropic(
            model=model_name,
            api_key=api_key,
            temperature=0.2,
            max_tokens=4096,
        )
    elif provider == "custom":
        if not base_url or not model:
            raise ValueError("Custom provider requires base_url and model")
        # Use OpenAI-compatible interface for custom providers
        llm_instance = ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url=base_url,
            temperature=0.2,
            max_tokens=4096,
        )
    else:
        # Fallback to Gemini
        llm_instance = ChatGoogleGenerativeAI(
            model=MODEL_MAP["gemini-2.5-flash"],
            google_api_key=api_key,
            temperature=0.2,
            max_tokens=4096,
        )
    
    # Store provider for error handling
    llm_instance._provider = provider
    return llm_instance


def classify_with_rules(
    subject: str,
    from_address: str,
    snippet: str,
    body_preview: str,
    labels: List[str],
) -> Optional[ClassificationResult]:
    """Classify email using rule-based heuristics. Returns None if no match."""
    subject_lower = (subject or "").lower()
    from_lower = (from_address or "").lower()
    snippet_lower = (snippet or "").lower()
    body_lower = (body_preview or "").lower()
    combined_text = f"{subject_lower} {snippet_lower} {body_lower}".lower()
    
    # Extract domain from email
    domain = ""
    if "@" in from_address:
        domain = from_address.split("@")[1].lower()
    
    # Rule 1: Newsletters
    newsletter_domains = [
        "mailchimp.com", "substack.com", "medium.com", "ghost.org",
        "convertkit.com", "mailerlite.com", "constantcontact.com",
        "campaignmonitor.com", "aweber.com", "getresponse.com"
    ]
    newsletter_keywords = ["newsletter", "unsubscribe", "manage preferences", "email preferences"]
    if any(nd in domain for nd in newsletter_domains) or \
       any(keyword in combined_text for keyword in newsletter_keywords) or \
       "unsubscribe" in combined_text:
        return ClassificationResult(
            category="newsletters",
            priority="LOW",
            needs_reply=False,
            spam_score=0.1,
            sensitive_flags=[],
            confidence=0.9
        )
    
    # Rule 2: Receipts
    receipt_domains = [
        "amazon.com", "stripe.com", "paypal.com", "square.com",
        "shopify.com", "etsy.com", "ebay.com", "apple.com",
        "google.com", "microsoft.com"
    ]
    receipt_keywords = ["receipt", "order confirmation", "order #", "invoice #", "purchase confirmation"]
    if any(rd in domain for rd in receipt_domains) and \
       any(keyword in combined_text for keyword in receipt_keywords):
        return ClassificationResult(
            category="receipts",
            priority="LOW",
            needs_reply=False,
            spam_score=0.0,
            sensitive_flags=[],
            confidence=0.95
        )
    
    # Rule 3: Shipping
    shipping_domains = [
        "ups.com", "fedex.com", "usps.com", "dhl.com",
        "ontrac.com", "lasership.com", "amazon.com"
    ]
    shipping_keywords = ["tracking", "shipped", "delivery", "out for delivery", "package", "parcel"]
    if any(sd in domain for sd in shipping_domains) or \
       any(keyword in combined_text for keyword in shipping_keywords):
        return ClassificationResult(
            category="shipping",
            priority="NORMAL",
            needs_reply=False,
            spam_score=0.0,
            sensitive_flags=[],
            confidence=0.9
        )
    
    # Rule 4: Bills
    bill_keywords = ["bill", "invoice", "payment due", "statement", "amount due", "pay now"]
    if any(keyword in combined_text for keyword in bill_keywords):
        return ClassificationResult(
            category="bills",
            priority="HIGH",
            needs_reply=False,
            spam_score=0.0,
            sensitive_flags=[],
            confidence=0.85
        )
    
    # Rule 5: Social
    social_domains = [
        "facebook.com", "twitter.com", "linkedin.com", "instagram.com",
        "tiktok.com", "pinterest.com", "reddit.com", "discord.com"
    ]
    if any(sd in domain for sd in social_domains):
        return ClassificationResult(
            category="social",
            priority="LOW",
            needs_reply=False,
            spam_score=0.2,
            sensitive_flags=[],
            confidence=0.9
        )
    
    # Rule 6: School
    school_keywords = ["course", "assignment", "grade", "homework", "syllabus", "lecture"]
    if domain.endswith(".edu") or any(keyword in combined_text for keyword in school_keywords):
        return ClassificationResult(
            category="school",
            priority="NORMAL",
            needs_reply=True,  # School emails often need replies
            spam_score=0.0,
            sensitive_flags=[],
            confidence=0.85
        )
    
    # Rule 7: Hiring/Recruiting
    hiring_keywords = ["job", "position", "opportunity", "interview", "recruiter", "application", "resume"]
    hiring_domains = ["linkedin.com", "indeed.com", "glassdoor.com", "monster.com"]
    if any(hd in domain for hd in hiring_domains) or \
       any(keyword in combined_text for keyword in hiring_keywords):
        return ClassificationResult(
            category="hiring",
            priority="HIGH",
            needs_reply=True,
            spam_score=0.1,
            sensitive_flags=[],
            confidence=0.8
        )
    
    # Rule 8: Finance
    finance_keywords = ["bank", "account", "transaction", "balance", "statement", "investment"]
    finance_domains = ["chase.com", "bankofamerica.com", "wellsfargo.com", "citi.com"]
    if any(fd in domain for fd in finance_domains) or \
       any(keyword in combined_text for keyword in finance_keywords):
        return ClassificationResult(
            category="finance",
            priority="HIGH",
            needs_reply=False,
            spam_score=0.0,
            sensitive_flags=["bank_account"],
            confidence=0.85
        )
    
    # No rule matched - return None to use LLM
    return None


def classify_email(
    llm: BaseChatModel,
    subject: str,
    from_address: str,
    snippet: str,
    body_preview: str,
    labels: List[str],
) -> ClassificationResult:
    """Classify an email."""
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are an email classification assistant. Analyze the email and classify it.

Categories:
- hiring: Job opportunities, interviews, recruiter outreach
- bills: Invoices, payment due, bills, statements
- school: Education, courses, academic communications
- receipts: Purchase confirmations, order receipts
- newsletters: Marketing emails, newsletters, promotional content
- social: Social media notifications, friend requests
- shipping: Package tracking, delivery updates
- finance: Bank statements, investment updates, financial alerts
- misc: Everything else

Return a JSON object with these fields:
- category: string (one of the categories above)
- priority: string (LOW, NORMAL, HIGH, or URGENT)
- needs_reply: boolean
- spam_score: number 0-1
- sensitive_flags: array of strings (detected sensitive content types)
- confidence: number 0-1"""),
        ("human", """Classify this email:
Subject: {subject}
From: {from_address}
Labels: {labels}
Snippet: {snippet}
Body preview: {body_preview}""")
    ])
    
    parser = JsonOutputParser(pydantic_object=ClassificationResult)
    chain = prompt | llm | parser
    
    try:
        result = chain.invoke({
            "subject": subject or "(No subject)",
            "from_address": from_address,
            "labels": ", ".join(labels) if labels else "None",
            "snippet": snippet or "",
            "body_preview": (body_preview or "")[:500],
        })
        
        return ClassificationResult(**result)
    except Exception as e:
        # Re-raise as classified LLM error
        provider = getattr(llm, '_provider', 'unknown')
        raise classify_llm_error(e, provider) from e


def summarize_thread(
    llm: BaseChatModel,
    subject: str,
    messages: List[Dict[str, str]],
    previous_summary: Optional[str] = None,
) -> SummaryResult:
    """Summarize an email thread."""
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are an email summarization assistant. Create concise summaries of email threads.

Guidelines:
- Short summary: 1-2 sentences, key point only
- Full summary: 2-4 sentences with important details
- If there's a previous summary and new messages, explain what changed

Return a JSON object with these fields:
- short_summary: string
- full_summary: string
- what_changed: string or null"""),
        ("human", """Summarize this email thread:
Subject: {subject}

Messages:
{messages_text}
{previous_summary_text}""")
    ])
    
    messages_text = "\n\n".join([
        f"[{i+1}] From: {m['from']} ({m['date']})\n{m['body'][:300]}"
        for i, m in enumerate(messages)
    ])
    
    previous_summary_text = f"\nPrevious summary: {previous_summary}" if previous_summary else ""
    
    parser = JsonOutputParser(pydantic_object=SummaryResult)
    chain = prompt | llm | parser
    
    try:
        result = chain.invoke({
            "subject": subject or "(No subject)",
            "messages_text": messages_text,
            "previous_summary_text": previous_summary_text,
        })
        
        return SummaryResult(**result)
    except Exception as e:
        provider = getattr(llm, '_provider', 'unknown')
        raise classify_llm_error(e, provider) from e


def extract_from_email(
    llm: BaseChatModel,
    subject: str,
    body: str,
) -> ExtractionResult:
    """Extract structured information from an email."""
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are an email extraction assistant. Extract structured information from emails.

Extract:
- Tasks: action items mentioned
- Deadlines: dates and time-sensitive items
- Entities: people, organizations, locations, contact info, URLs
- Key facts: important information worth remembering

Return a JSON object with these fields:
- tasks: array of objects with title, dueDate (optional), priority
- deadlines: array of objects with description, date
- entities: object with people, organizations, locations, phoneNumbers, emails, urls (all arrays)
- key_facts: array of strings"""),
        ("human", """Extract information from this email:
Subject: {subject}
Body: {body}""")
    ])
    
    parser = JsonOutputParser(pydantic_object=ExtractionResult)
    chain = prompt | llm | parser
    
    try:
        result = chain.invoke({
            "subject": subject or "(No subject)",
            "body": (body or "")[:2000],
        })
        
        return ExtractionResult(**result)
    except Exception as e:
        provider = getattr(llm, '_provider', 'unknown')
        raise classify_llm_error(e, provider) from e


def generate_embedding(api_key_enc: str, text: str, provider: str = "gemini") -> Optional[List[float]]:
    """Generate an embedding for text. Returns None if provider doesn't support embeddings."""
    try:
        if provider.startswith("gemini-"):
            import google.generativeai as genai
            api_key = decrypt(api_key_enc)
            genai.configure(api_key=api_key)
            result = genai.embed_content(
                model="models/text-embedding-004",
                content=text[:2048],
            )
            return result['embedding']
        elif provider.startswith("openai-"):
            import openai
            api_key = decrypt(api_key_enc)
            client = openai.OpenAI(api_key=api_key)
            response = client.embeddings.create(
                model="text-embedding-3-small",
                input=text[:2048],
            )
            return response.data[0].embedding
        else:
            # Anthropic and custom providers don't have embedding APIs
            # Return None to skip embedding generation
            return None
    except Exception as e:
        # If embedding fails, return None (embeddings are optional)
        print(f"Warning: Failed to generate embedding: {e}")
        return None


# Sensitive content detection patterns
SENSITIVE_PATTERNS = {
    "potential_ssn": r'\b\d{3}[-.]?\d{2}[-.]?\d{4}\b',
    "potential_credit_card": r'\b(?:\d{4}[-.\s]?){3}\d{4}\b',
    "phone_number": r'\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b',
    "physical_address": r'\b\d+\s+[A-Za-z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln)\b',
    "bank_account": r'\b(?:account|routing)[:\s#]*\d{8,17}\b',
    "credential": r'\b(?:password|passwd|pwd)[:\s]+\S+',
}


def detect_sensitive_patterns(text: str) -> List[str]:
    """Detect sensitive content patterns in text."""
    flags = []
    
    for flag_name, pattern in SENSITIVE_PATTERNS.items():
        if re.search(pattern, text, re.IGNORECASE):
            flags.append(flag_name)
    
    # Check for multiple email addresses
    emails = re.findall(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', text)
    if len(emails) > 2:
        flags.append("multiple_emails")
    
    return flags


def redact_sensitive_content(text: str) -> str:
    """Redact sensitive content from text."""
    redacted = text
    
    # Redact SSN
    redacted = re.sub(r'\b\d{3}[-.]?\d{2}[-.]?\d{4}\b', '[REDACTED-SSN]', redacted)
    
    # Redact credit card
    redacted = re.sub(r'\b(?:\d{4}[-.\s]?){3}\d{4}\b', '[REDACTED-CC]', redacted)
    
    # Redact bank account numbers
    redacted = re.sub(r'\b(?:account|routing)[:\s#]*\d{8,17}\b', '[REDACTED-ACCOUNT]', redacted, flags=re.IGNORECASE)
    
    # Redact passwords
    redacted = re.sub(r'\b(?:password|passwd|pwd)[:\s]+\S+', '[REDACTED-CREDENTIAL]', redacted, flags=re.IGNORECASE)
    
    return redacted
