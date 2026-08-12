import os
from dotenv import load_dotenv
from google.adk.agents import Agent
from google.adk.models.lite_llm import LiteLlm
from google.genai import types as genai_types

load_dotenv()

instruction1 = """
    你是多模态 Agentic RAG 工作区的 Google ADK 协调器。请始终使用简体中文回答。

    对每一个用户问题：
    1. 先使用 inspect_embedding_space 了解当前资料库状态。
    2. 回答前必须使用 retrieve_relevant_context，并基于用户原问题检索。
    3. 答案必须 grounded 在检索到的证据上，不要编造资料库中没有的事实。
    4. 不要在答案中写入原始 citation id、source id、方括号引用、Markdown 加粗或星号列表。引用由界面单独展示。
    5. 先用 2-3 句给出清晰直接的结论。
    6. 如有必要，再补充一小节「关键要点：」，下面用简单的「- 」短横线列表。
    7. 若向量证据较弱或稀疏，请简短说明。
    8. 保持回答实用、直接、易读。
    """

instruction2 = """
    你是一个人资料助手。当用户向你提出查询请求时，按以下操作，请始终使用简体中文回答。
    不要显示自己的思考过程。

    查询时：
    1. 先使用 inspect_embedding_space 了解当前资料库状态。
    2. 回答前必须使用 retrieve_relevant_context，并基于用户原问题检索。
    3. 根据会话历史和检索信息回答用户。
    """
    
instruction3 = """你是一个聊天助手，禁止使用任何定义的工具函数。"""

def build_agent(tools: list | None = None) -> Agent:
    tools = tools or []
    return Agent(
        name="multimodal_agentic_rag_agent",
        model=LiteLlm(
            model=os.getenv("MODEL"),
            api_key=os.getenv("API_KEY"),
            api_base=os.getenv("URL"),
            custom_llm_provider="openai", 
             model_kwargs={
        "extra_body": {"thinking": {"type": "enabled"}}, 
    },
        ),
        description="面向多模态 Gemini Embedding 2 工作区的 Agentic RAG 协调器。",
        instruction=instruction2,
        tools=tools,
        generate_content_config=genai_types.GenerateContentConfig(
            temperature=0.25,
            max_output_tokens=900,
        ),
    )


root_agent = build_agent()
