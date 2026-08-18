FROM python:3.10-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir torch \
      --index-url https://mirrors.aliyun.com/pytorch-wheels/cpu \
      --extra-index-url https://pypi.tuna.tsinghua.edu.cn/simple \
 && pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8897
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8897"]