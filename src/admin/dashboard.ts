      const requestedToken = typeof body.botToken === "string" ? body.botToken.trim() : "";
      const result = await connectTelegramBot(env, new URL(request.url).origin, requestedToken || undefined);
      await recordAdminAudit(env,actor,"connect_telegram",null,{
        botUsername:result.botUsername,
        botId:result.botId,
        switched:result.switched,
        previousBotUsername:result.previousBotUsername,
      });
      return json({
        ok:true,
        action,
        botUsername:result.botUsername,
        botId:result.botId,
        switched:result.switched,
        previousBotUsername:result.previousBotUsername,
      });
    }
    if (action === "disconnect_telegram") {
      const active = await getActiveTelegramBot(env);
      if (!active) return json({ok:true,action,disconnected:false});
      await telegramAdminApi(active.token, "deleteWebhook", { drop_pending_updates: true });
      await markTelegramBotDisconnected(env, active.connectionId, "admin_disconnect");
      await recordAdminAudit(env,actor,"disconnect_telegram",null,{botUsername:active.username,botId:active.botId});
      return json({ok:true,action,disconnected:true});
    }
    if (action === "test_telegram") {
      const active = await getActiveTelegramBot(env);
      const webhookUrl = new URL(request.url).origin + "/telegram/webhook";
      if (!active) {
        if (await hasTelegramBotRecords(env)) return json({ok:false,error:"telegram_not_connected"},409);
        if (!env.TELEGRAM_BOT_TOKEN?.trim() || !env.TELEGRAM_WEBHOOK_SECRET?.trim()) return json({ok:false,error:"telegram_not_connected"},409);
        const token = env.TELEGRAM_BOT_TOKEN.trim();
        const bot = await telegramAdminApi<{id:number;username?:string;first_name?:string}>(token,"getMe",{});
        await telegramAdminApi(token,"setWebhook",{
          url:webhookUrl,
          secret_token:env.TELEGRAM_WEBHOOK_SECRET.trim(),
          allowed_updates:["message","poll_answer"],
          drop_pending_updates:false,
          max_connections:100,
        });
        const webhook = await telegramAdminApi<{url?:string;pending_update_count?:number}>(token,"getWebhookInfo",{});
        return json({ok:true,legacy:true,botUsername:bot.username ? "@" + bot.username : bot.first_name ?? "Telegram bot",botId:bot.id,webhook});
      }
      const bot = await telegramAdminApi<{id:number;username?:string;first_name?:string}>(active.token,"getMe",{});
      await telegramAdminApi(active.token,"setWebhook",{
        url:webhookUrl,
        secret_token:active.webhookSecret,
        allowed_updates:["message","poll_answer"],
        drop_pending_updates:false,
        max_connections:100,
      });
      const webhook = await telegramAdminApi<{url?:string;pending_update_count?:number}>(active.token,"getWebhookInfo",{});
      await markTelegramBotVerified(env, active.connectionId);
      return json({ok:true,legacy:false,botUsername:bot.username ? "@" + bot.username : bot.first_name ?? "Telegram bot",botId:bot.id,webhook});
    }
    if (action === "grant_unlimited") {
      await grantUnlimitedAiAccess(env,userId,0,null);