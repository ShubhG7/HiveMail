"""LLM service for email processing."""

import re
import json
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser

from encryption import decrypt


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
    "gemini-2.5-flash": "gemini-2.5-flash-preview-05-20",
    "gemini-2.5-pro": "gemini-2.5-pro-preview-05-06",
    "gemini-2.0-flash": "gemini-2.0-flash",
}


def get_llm(api_key_enc: str, model: str = "gemini-2.5-flash") -> ChatGoogleGenerativeAI:
    """Get an LLM instance."""
    api_key = decrypt(api_key_enc)
    model_name = MODEL_MAP.get(model, MODEL_MAP["gemini-2.5-flash"])
    
    return ChatGoogleGenerativeAI(
        model=model_name,
        google_api_key=api_key,
        temperature=0.2,
        max_tokens=4096,
    )


def classify_email(
    llm: ChatGoogleGenerativeAI,
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
    
    result = chain.invoke({
        "subject": subject or "(No subject)",
        "from_address": from_address,
        "labels": ", ".join(labels) if labels else "None",
        "snippet": snippet or "",
        "body_preview": (body_preview or "")[:500],
    })
    
    return ClassificationResult(**result)


def summarize_thread(
    llm: ChatGoogleGenerativeAI,
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
    
    result = chain.invoke({
        "subject": subject or "(No subject)",
        "messages_text": messages_text,
        "previous_summary_text": previous_summary_text,
    })
    
    return SummaryResult(**result)


def extract_from_email(
    llm: ChatGoogleGenerativeAI,
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
    
    result = chain.invoke({
        "subject": subject or "(No subject)",
        "body": (body or "")[:2000],
    })
    
    return ExtractionResult(**result)


def generate_embedding(api_key_enc: str, text: str) -> List[float]:
    """Generate an embedding for text using Google's embedding model."""
    import google.generativeai as genai
    
    api_key = decrypt(api_key_enc)
    genai.configure(api_key=api_key)
    
    result = genai.embed_content(
        model="models/text-embedding-004",
        content=text[:2048],
    )
    
    return result['embedding']


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
