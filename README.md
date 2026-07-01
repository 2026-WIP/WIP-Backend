# WIP Backend

WIP 백엔드 레포지토리입니다. 프론트엔드에서 사용하는 인증, 채널, 메시지, DM, 친구, 알림, 스니펫, 코드 실행 요청을 처리하는 Express 기반 API 서버입니다.

## 사용 기술

- Node.js
- Express
- TypeScript
- MySQL
- Socket.io
- JWT

## 주요 기능

- 회원가입, 로그인, 로그아웃, 세션 확인
- access token, refresh token 기반 인증
- 채널 생성, 수정, 삭제, 멤버 초대
- 채널 메시지, 스레드 메시지 저장
- DM 대화방과 DM 메시지 관리
- 친구 요청, 수락, 거절, 삭제
- 알림, 읽지 않은 메시지, 사용자 설정 관리
- 코드 실행 runner API
- 인증된 Socket.io 채널 이벤트

## 실행 방법

로컬 실행에 필요한 항목입니다.

- Node.js
- MySQL Server 8.x

의존성을 설치한 뒤 서버를 실행합니다.

```bash
npm install
npm run start
```

`npm run start`는 로컬 MySQL 실행 스크립트, TypeScript 빌드, API 서버 실행을 순서대로 처리합니다. 기본 API 주소는 아래와 같습니다.

```txt
http://localhost:3000/api
```

## 환경 변수

`.env.example`을 참고해서 `.env` 파일을 만듭니다.

```txt
PORT=3000
DATABASE_URL=mysql://wip:wip_password@localhost:3306/wip_dev
JWT_SECRET=change-me
```

## Docker 실행

Docker를 사용할 경우 아래 명령으로 DB와 서버를 실행할 수 있습니다.

```bash
docker compose up -d
```

## 자주 쓰는 명령어

```bash
npm run db:local
npm run dev
npm run build
npm start
```

헬스 체크는 아래 주소로 확인합니다.

```bash
curl http://localhost:3000/api/health
```

## API 문서

전체 API 구조는 `openapi.yaml`에 정리되어 있습니다. 서버 실행 시 개발용 테이블이 없으면 필요한 테이블을 자동으로 준비합니다.
