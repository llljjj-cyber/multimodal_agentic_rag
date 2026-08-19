FROM python:3.10-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir torch \
     --index-url https://mirrors.aliyun.com/pytorch-wheels/cpu \
 && pip install --no-cache-dir -r requirements.txt \
      -i https://pypi.tuna.tsinghua.edu.cn/simple \
 && python -c "import torch; assert not torch.cuda.is_available(), torch.__version__"

COPY . .

EXPOSE 8897
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8897"]